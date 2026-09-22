'use client'

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore'
import { firestore } from './firebase/client'
import { defaultWarnings } from './maintenance'
import { computeAvgKmPerDay } from './odometer'
import { fuelTypesFromDoc, gradeFromDoc, intervalFromDoc } from './parse'
import {
  DEFAULT_SETTINGS,
  type Car,
  type FuelLoad,
  type Job,
  type MaintenanceRule,
  type OdometerReading,
  type OdometerSource,
  type TimeInterval,
  type UserSettings,
} from './types'

// Todo cuelga de users/{uid}; las colecciones hijas guardan carId para poder consultar entre autos.
const userDoc = (uid: string) => doc(firestore(), 'users', uid)
const col = (uid: string, name: CollectionName) => collection(firestore(), 'users', uid, name)

type CollectionName = 'cars' | 'rules' | 'jobs' | 'fuel' | 'odometer' | 'pushSubscriptions'

export const newId = (uid: string, name: CollectionName) => doc(col(uid, name)).id

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate()
  if (v instanceof Date) return v
  return null
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

// ---- Conversión Firestore -> tipos de la app (tolerante a campos faltantes)

function carFrom(d: QueryDocumentSnapshot<DocumentData>): Car {
  const x = d.data()
  return {
    id: d.id,
    brand: x.brand ?? '',
    model: x.model ?? '',
    version: str(x.version),
    year: num(x.year),
    plate: str(x.plate),
    fuelTypes: fuelTypesFromDoc(x.fuelTypes),
    currentKm: num(x.currentKm) ?? 0,
    kmUpdatedAt: toDate(x.kmUpdatedAt),
    avgKmPerDay: num(x.avgKmPerDay),
    photoUrl: str(x.photoUrl),
    photoPublicId: str(x.photoPublicId),
    createdAt: toDate(x.createdAt) ?? new Date(0),
  }
}

function ruleFrom(d: QueryDocumentSnapshot<DocumentData>): MaintenanceRule {
  const x = d.data()
  return {
    id: d.id,
    carId: x.carId,
    name: x.name ?? '',
    intervalKm: num(x.intervalKm),
    intervalTime: intervalFromDoc(x),
    repeat: x.repeat !== false,
    lastDoneKm: num(x.lastDoneKm),
    lastDoneDate: str(x.lastDoneDate),
    warnKm: num(x.warnKm) ?? 500,
    warnDays: num(x.warnDays) ?? 30,
    lastNotifiedAt: toDate(x.lastNotifiedAt),
    lastNotifiedStatus: x.lastNotifiedStatus ?? null,
  }
}

function jobFrom(d: QueryDocumentSnapshot<DocumentData>): Job {
  const x = d.data()
  return {
    id: d.id,
    carId: x.carId,
    date: x.date,
    km: num(x.km),
    title: x.title ?? '',
    category: x.category ?? 'otros',
    cost: num(x.cost) ?? 0,
    workshop: str(x.workshop),
    notes: str(x.notes),
    ruleIds: Array.isArray(x.ruleIds) ? x.ruleIds : [],
    createdAt: toDate(x.createdAt) ?? new Date(0),
  }
}

function fuelFrom(d: QueryDocumentSnapshot<DocumentData>): FuelLoad {
  const x = d.data()
  return {
    id: d.id,
    carId: x.carId,
    date: x.date,
    km: num(x.km),
    fuelType: x.fuelType === 'gnc' ? 'gnc' : 'nafta',
    grade: x.fuelType === 'gnc' ? null : gradeFromDoc(x.grade),
    quantity: num(x.quantity) ?? 0,
    unitPrice: num(x.unitPrice) ?? 0,
    total: num(x.total) ?? 0,
    fullTank: x.fullTank !== false,
    station: str(x.station),
    createdAt: toDate(x.createdAt) ?? new Date(0),
  }
}

function readingFrom(d: QueryDocumentSnapshot<DocumentData>): OdometerReading {
  const x = d.data()
  return { id: d.id, carId: x.carId, km: num(x.km) ?? 0, date: toDate(x.date) ?? new Date(0), source: x.source ?? 'manual' }
}

// ---- Suscripciones en tiempo real

export interface UserData {
  settings: UserSettings
  cars: Car[]
  rules: MaintenanceRule[]
  jobs: Job[]
  fuel: FuelLoad[]
  odometer: OdometerReading[]
}

type Part = keyof UserData

export function subscribeUserData(
  uid: string,
  onChange: (patch: Partial<UserData>, loaded: Part) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const subs: Unsubscribe[] = []
  subs.push(
    onSnapshot(
      userDoc(uid),
      snap => {
        const x = snap.data()
        if (!snap.exists() && !snap.metadata.fromCache) {
          // Primer ingreso: crea el documento con la configuración por defecto (lo necesita el cron).
          void setDoc(userDoc(uid), { ...DEFAULT_SETTINGS, createdAt: Timestamp.now() }, { merge: true })
        }
        onChange(
          {
            settings: {
              reminder: { ...DEFAULT_SETTINGS.reminder, ...(x?.reminder ?? {}) },
              timezone: x?.timezone ?? DEFAULT_SETTINGS.timezone,
            },
          },
          'settings',
        )
      },
      onError,
    ),
  )
  const listen = <T,>(name: CollectionName, part: Part, map: (d: QueryDocumentSnapshot<DocumentData>) => T) =>
    subs.push(onSnapshot(col(uid, name), snap => onChange({ [part]: snap.docs.map(map) }, part), onError))

  listen('cars', 'cars', carFrom)
  listen('rules', 'rules', ruleFrom)
  listen('jobs', 'jobs', jobFrom)
  listen('fuel', 'fuel', fuelFrom)
  listen('odometer', 'odometer', readingFrom)
  return () => subs.forEach(u => u())
}

// ---- Kilometraje

/**
 * Registra una lectura del odómetro y, si es la más alta, actualiza el km actual del auto
 * y recalcula el promedio diario.
 */
function addReadingToBatch(
  batch: WriteBatch,
  uid: string,
  car: Car,
  readings: OdometerReading[],
  km: number,
  source: OdometerSource,
  date = new Date(),
) {
  const id = newId(uid, 'odometer')
  batch.set(doc(col(uid, 'odometer'), id), { carId: car.id, km, date: Timestamp.fromDate(date), source })
  if (km >= car.currentKm) {
    const carReadings = readings.filter(r => r.carId === car.id).concat({ id, carId: car.id, km, date, source })
    batch.update(doc(col(uid, 'cars'), car.id), {
      currentKm: km,
      kmUpdatedAt: Timestamp.fromDate(date),
      avgKmPerDay: computeAvgKmPerDay(carReadings),
    })
  }
}

export async function recordKm(uid: string, car: Car, readings: OdometerReading[], km: number) {
  const batch = writeBatch(firestore())
  addReadingToBatch(batch, uid, car, readings, km, 'manual')
  await batch.commit()
}

/** Km actual del auto a partir de sus lecturas: la más alta manda. */
function carKmFrom(readings: OdometerReading[]) {
  const latest = readings.reduce<OdometerReading | null>((best, r) => (!best || r.km > best.km ? r : best), null)
  return {
    currentKm: latest?.km ?? 0,
    kmUpdatedAt: latest ? Timestamp.fromDate(latest.date) : null,
    avgKmPerDay: computeAvgKmPerDay(readings),
  }
}

/** Borra una lectura (para corregir un error de tipeo) y recalcula el km actual con las que quedan. */
export async function deleteReading(uid: string, car: Car, readings: OdometerReading[], readingId: string) {
  const remaining = readings.filter(r => r.carId === car.id && r.id !== readingId)
  const batch = writeBatch(firestore())
  batch.delete(doc(col(uid, 'odometer'), readingId))
  batch.update(doc(col(uid, 'cars'), car.id), carKmFrom(remaining))
  await batch.commit()
}

/** Vuelve a poner una lectura borrada ("Deshacer") y recalcula el km actual. */
export async function restoreReading(uid: string, car: Car, readings: OdometerReading[], reading: OdometerReading) {
  const all = readings.filter(r => r.carId === car.id && r.id !== reading.id).concat(reading)
  const batch = writeBatch(firestore())
  batch.set(doc(col(uid, 'odometer'), reading.id), {
    carId: reading.carId,
    km: reading.km,
    date: Timestamp.fromDate(reading.date),
    source: reading.source,
  })
  batch.update(doc(col(uid, 'cars'), car.id), carKmFrom(all))
  await batch.commit()
}

// ---- Autos

export type CarInput = Pick<Car, 'brand' | 'model' | 'version' | 'year' | 'plate' | 'fuelTypes'> & {
  photoUrl?: string | null
  photoPublicId?: string | null
}

export async function createCar(uid: string, data: CarInput, initialKm: number, carId = newId(uid, 'cars')) {
  const now = new Date()
  const batch = writeBatch(firestore())
  batch.set(doc(col(uid, 'cars'), carId), {
    ...data,
    currentKm: initialKm,
    kmUpdatedAt: Timestamp.fromDate(now),
    avgKmPerDay: null,
    createdAt: Timestamp.fromDate(now),
  })
  batch.set(doc(col(uid, 'odometer')), { carId, km: initialKm, date: Timestamp.fromDate(now), source: 'initial' })
  await batch.commit()
  return carId
}

export async function updateCar(uid: string, carId: string, data: Partial<CarInput>) {
  const batch = writeBatch(firestore())
  batch.update(doc(col(uid, 'cars'), carId), data)
  await batch.commit()
}

type RelatedName = 'rules' | 'jobs' | 'fuel' | 'odometer'

async function deleteRefs(refs: ReturnType<typeof doc>[]) {
  // Un batch admite hasta 500 operaciones.
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(firestore())
    refs.slice(i, i + 450).forEach(r => batch.delete(r))
    await batch.commit()
  }
}

/**
 * Borra el auto y todo lo asociado (mantenimientos, trabajos, cargas y lecturas).
 * Primero borra lo que la app ya tiene en memoria junto con el auto: se aplica al instante en la
 * caché local, así desaparece de la pantalla enseguida. Después barre en el servidor lo que pudiera
 * haber quedado (por ejemplo, cargado desde otro dispositivo).
 */
export async function deleteCar(uid: string, carId: string, known: Partial<Record<RelatedName, string[]>> = {}) {
  const related = ['rules', 'jobs', 'fuel', 'odometer'] as const
  await deleteRefs([
    doc(col(uid, 'cars'), carId),
    ...related.flatMap(name => (known[name] ?? []).map(id => doc(col(uid, name), id))),
  ])
  const leftovers: ReturnType<typeof doc>[] = []
  for (const name of related) {
    const snap = await getDocs(query(col(uid, name), where('carId', '==', carId)))
    leftovers.push(...snap.docs.map(d => d.ref))
  }
  if (leftovers.length) await deleteRefs(leftovers)
}

// ---- Mantenimientos

export type RuleInput = Pick<
  MaintenanceRule,
  'carId' | 'name' | 'intervalKm' | 'intervalTime' | 'repeat' | 'lastDoneKm' | 'lastDoneDate' | 'warnKm' | 'warnDays'
>

export async function saveRule(uid: string, data: RuleInput, ruleId = newId(uid, 'rules')) {
  // Al editar se resetea el aviso para que vuelva a notificar con los datos nuevos.
  await setDoc(doc(col(uid, 'rules'), ruleId), { ...data, lastNotifiedAt: null, lastNotifiedStatus: null })
  return ruleId
}

export async function deleteRule(uid: string, ruleId: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(col(uid, 'rules'), ruleId))
  await batch.commit()
}

/** Vuelve a crear un mantenimiento borrado, tal cual estaba ("Deshacer"). */
export async function restoreRule(uid: string, rule: MaintenanceRule) {
  const { id, lastNotifiedAt, ...data } = rule
  await setDoc(doc(col(uid, 'rules'), id), {
    ...data,
    lastNotifiedAt: lastNotifiedAt ? Timestamp.fromDate(lastNotifiedAt) : null,
  })
}

// ---- Trabajos

export type JobInput = Omit<Job, 'id' | 'createdAt'>

/** "Volver al taller en…": recordatorio de una sola vez que se crea junto con un trabajo. */
export interface FollowUp {
  name: string
  intervalTime: TimeInterval
}

/**
 * Guarda un trabajo. Los mantenimientos marcados se dan por hechos en la fecha/km del trabajo
 * (sólo si es más reciente que la última vez registrada): los periódicos se reinician y los de una
 * sola vez se borran. Si el km es mayor al actual se registra, y opcionalmente agenda la vuelta al taller.
 */
export async function saveJob(
  uid: string,
  ctx: { car: Car; rules: MaintenanceRule[]; readings: OdometerReading[] },
  data: JobInput,
  jobId?: string,
  followUp?: FollowUp | null,
) {
  const batch = writeBatch(firestore())
  const id = jobId ?? newId(uid, 'jobs')
  const existing = jobId ? {} : { createdAt: Timestamp.now() }
  batch.set(doc(col(uid, 'jobs'), id), { ...data, ...existing }, { merge: true })

  const doneKm = data.km ?? ctx.car.currentKm
  for (const rule of ctx.rules.filter(r => data.ruleIds.includes(r.id))) {
    const isNewer = !rule.lastDoneDate || data.date >= rule.lastDoneDate
    if (!isNewer) continue
    if (!rule.repeat) {
      batch.delete(doc(col(uid, 'rules'), rule.id))
      continue
    }
    batch.update(doc(col(uid, 'rules'), rule.id), {
      lastDoneKm: rule.intervalKm != null ? doneKm : rule.lastDoneKm,
      lastDoneDate: data.date,
      lastNotifiedAt: null,
      lastNotifiedStatus: null,
    })
  }
  if (followUp) {
    batch.set(doc(col(uid, 'rules')), {
      carId: ctx.car.id,
      name: followUp.name,
      intervalKm: null,
      intervalTime: followUp.intervalTime,
      repeat: false,
      lastDoneKm: doneKm,
      lastDoneDate: data.date,
      ...defaultWarnings(null, followUp.intervalTime),
      lastNotifiedAt: null,
      lastNotifiedStatus: null,
    })
  }
  if (data.km != null && data.km > ctx.car.currentKm) {
    addReadingToBatch(batch, uid, ctx.car, ctx.readings, data.km, 'job')
  }
  await batch.commit()
  return id
}

export async function deleteJob(uid: string, jobId: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(col(uid, 'jobs'), jobId))
  await batch.commit()
}

/** Vuelve a crear un trabajo borrado ("Deshacer"). Borrarlo no había tocado mantenimientos ni km. */
export async function restoreJob(uid: string, job: Job) {
  const { id, createdAt, ...data } = job
  await setDoc(doc(col(uid, 'jobs'), id), { ...data, createdAt: Timestamp.fromDate(createdAt) })
}

// ---- Combustible

export type FuelInput = Omit<FuelLoad, 'id' | 'createdAt'>

export async function saveFuel(
  uid: string,
  ctx: { car: Car; readings: OdometerReading[] },
  data: FuelInput,
  fuelId?: string,
) {
  const batch = writeBatch(firestore())
  const id = fuelId ?? newId(uid, 'fuel')
  const existing = fuelId ? {} : { createdAt: Timestamp.now() }
  batch.set(doc(col(uid, 'fuel'), id), { ...data, ...existing }, { merge: true })
  if (data.km != null && data.km > ctx.car.currentKm) {
    addReadingToBatch(batch, uid, ctx.car, ctx.readings, data.km, 'fuel')
  }
  await batch.commit()
  return id
}

export async function deleteFuel(uid: string, fuelId: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(col(uid, 'fuel'), fuelId))
  await batch.commit()
}

/** Vuelve a crear una carga borrada ("Deshacer"). */
export async function restoreFuel(uid: string, load: FuelLoad) {
  const { id, createdAt, ...data } = load
  await setDoc(doc(col(uid, 'fuel'), id), { ...data, createdAt: Timestamp.fromDate(createdAt) })
}

// ---- Ajustes y notificaciones

export async function saveSettings(uid: string, settings: Partial<UserSettings>) {
  await setDoc(userDoc(uid), settings, { merge: true })
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function savePushSubscription(uid: string, sub: PushSubscriptionJSON) {
  const id = await sha256(sub.endpoint!)
  await setDoc(doc(col(uid, 'pushSubscriptions'), id), {
    endpoint: sub.endpoint,
    keys: sub.keys,
    userAgent: navigator.userAgent,
    createdAt: Timestamp.now(),
  })
}

export async function deletePushSubscription(uid: string, endpoint: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(col(uid, 'pushSubscriptions'), await sha256(endpoint)))
  await batch.commit()
}
