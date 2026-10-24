'use client'

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
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
import { computeAvgKmPerDay, topReading } from './odometer'
import { fuelTypeFromDoc, fuelTypesFromDoc, gradeFromDoc, intervalFromDoc } from './parse'
import {
  DEFAULT_SETTINGS,
  isLiquidFuel,
  type Actor,
  type AchievementRecord,
  type Car,
  type FuelLoad,
  type Job,
  type JobStatus,
  type MaintenanceRule,
  type OdometerReading,
  type OdometerSource,
  type TimeInterval,
  type UserSettings,
} from './types'

/**
 * Los ajustes, las suscripciones push y los logros cuelgan de users/{uid}. Cada auto es un documento de
 * primer nivel (cars/{carId}) y sus mantenimientos, trabajos, cargas y lecturas son subcolecciones suyas;
 * esos hijos guardan igual el carId para poder agrupar entre autos.
 */
const userDoc = (uid: string) => doc(firestore(), 'users', uid)
const userCol = (uid: string, name: UserCollectionName) => collection(firestore(), 'users', uid, name)
const carsCol = () => collection(firestore(), 'cars')
const carDoc = (carId: string) => doc(carsCol(), carId)
const carCol = (carId: string, name: RelatedName) => collection(firestore(), 'cars', carId, name)

type UserCollectionName = 'pushSubscriptions' | 'achievements'
type RelatedName = 'rules' | 'jobs' | 'fuel' | 'odometer'

const RELATED: readonly RelatedName[] = ['rules', 'jobs', 'fuel', 'odometer']

/** Id para un auto nuevo: el formulario lo necesita antes de crearlo, porque la foto se sube con ese id. */
export const newCarId = () => doc(carsCol()).id

const newChildId = (carId: string, name: RelatedName) => doc(carCol(carId, name)).id

/** Autoría de un registro que se vuelve a crear ("Deshacer"): conserva la original y, si falta, usa la de quien lo restaura. */
function authorOf(item: { createdBy?: string | null; createdByName?: string | null }, actor: Actor) {
  return item.createdBy
    ? { createdBy: item.createdBy, createdByName: item.createdByName ?? null }
    : { createdBy: actor.uid, createdByName: actor.name }
}

function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate()
  if (v instanceof Date) return v
  return null
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Un trabajo sin estado (guardado antes de compartir autos) cuenta como aprobado. */
const statusFrom = (v: unknown): JobStatus => (v === 'pending' || v === 'rejected' ? v : 'approved')

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
    status: statusFrom(x.status),
    createdBy: str(x.createdBy),
    createdByName: str(x.createdByName),
    createdAt: toDate(x.createdAt) ?? new Date(0),
  }
}

function fuelFrom(d: QueryDocumentSnapshot<DocumentData>): FuelLoad {
  const x = d.data()
  const fuelType = fuelTypeFromDoc(x.fuelType)
  return {
    id: d.id,
    carId: x.carId,
    date: x.date,
    km: num(x.km),
    fuelType,
    grade: isLiquidFuel(fuelType) ? gradeFromDoc(x.grade) : null,
    quantity: num(x.quantity) ?? 0,
    unitPrice: num(x.unitPrice) ?? 0,
    total: num(x.total) ?? 0,
    fullTank: x.fullTank !== false,
    station: str(x.station),
    createdBy: str(x.createdBy),
    createdByName: str(x.createdByName),
    createdAt: toDate(x.createdAt) ?? new Date(0),
  }
}

function readingFrom(d: QueryDocumentSnapshot<DocumentData>): OdometerReading {
  const x = d.data()
  return {
    id: d.id,
    carId: x.carId,
    km: num(x.km) ?? 0,
    date: toDate(x.date) ?? new Date(0),
    source: x.source ?? 'manual',
    createdBy: str(x.createdBy),
    createdByName: str(x.createdByName),
  }
}

function achievementFrom(d: QueryDocumentSnapshot<DocumentData>): AchievementRecord {
  const x = d.data()
  return {
    id: d.id,
    carId: str(x.carId),
    unlockedAt: toDate(x.unlockedAt) ?? new Date(0),
    celebratedAt: toDate(x.celebratedAt),
  }
}

export interface UserData {
  settings: UserSettings
  cars: Car[]
  rules: MaintenanceRule[]
  jobs: Job[]
  fuel: FuelLoad[]
  odometer: OdometerReading[]
  achievements: AchievementRecord[]
}

type Part = keyof UserData

const CAR_PART_MAPPERS: Record<RelatedName, (d: QueryDocumentSnapshot<DocumentData>) => unknown> = {
  rules: ruleFrom,
  jobs: jobFrom,
  fuel: fuelFrom,
  odometer: readingFrom,
}

/** Lo que se escucha de un auto: sus 4 subcolecciones, con la última foto de cada una y si salió de la caché. */
interface CarListeners {
  unsubs: Unsubscribe[]
  docs: Partial<Record<RelatedName, unknown[]>>
  fromCache: Partial<Record<RelatedName, boolean>>
}

/**
 * Escucha en tiempo real los ajustes y todas las colecciones del usuario. En `onChange`, `fromCache`
 * indica que la foto sale de la caché local y puede no tener lo último del servidor. En el primer
 * ingreso crea el documento del usuario con la configuración por defecto (lo necesita el cron).
 *
 * Los autos se escuchan filtrados por `ownerUid` (lo que pide la regla de lectura) y cada auto abre 4
 * listeners propios, que se abren y se cierran cuando el auto aparece o desaparece. `onChange` sigue
 * recibiendo una parte por colección: la de los mantenimientos, trabajos, cargas y lecturas sale cuando
 * todos los autos actuales entregaron su primera foto (enseguida si no hay autos), y `fromCache` es true
 * si alguna de esas fotos, o la lista de autos, salió de la caché. Si a un auto que ya había entregado
 * datos se le revoca el acceso (`permission-denied`, por ejemplo porque se borró desde otro dispositivo),
 * se lo da de baja sin avisar un error: la pantalla de error queda para los fallos reales.
 */
export function subscribeUserData(
  uid: string,
  onChange: (patch: Partial<UserData>, loaded: Part, fromCache: boolean) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  const subs: Unsubscribe[] = []
  subs.push(
    onSnapshot(
      userDoc(uid),
      snap => {
        const x = snap.data()
        if (!snap.exists() && !snap.metadata.fromCache) {
          setDoc(userDoc(uid), { ...DEFAULT_SETTINGS, createdAt: Timestamp.now() }, { merge: true }).catch(onError)
        }
        onChange(
          {
            settings: {
              reminder: { ...DEFAULT_SETTINGS.reminder, ...(x?.reminder ?? {}) },
              timezone: x?.timezone ?? DEFAULT_SETTINGS.timezone,
            },
          },
          'settings',
          snap.metadata.fromCache,
        )
      },
      onError,
    ),
  )
  subs.push(
    onSnapshot(
      userCol(uid, 'achievements'),
      snap => onChange({ achievements: snap.docs.map(achievementFrom) }, 'achievements', snap.metadata.fromCache),
      onError,
    ),
  )

  const perCar = new Map<string, CarListeners>()
  const revoked = new Set<string>()
  let carsReady = false
  let carsFromCache = true
  let carIdsKey = ''

  const publish = (part: RelatedName) => {
    if (!carsReady) return
    const all: unknown[] = []
    let fromCache = carsFromCache
    for (const entry of perCar.values()) {
      const docs = entry.docs[part]
      if (!docs) return
      all.push(...docs)
      fromCache ||= entry.fromCache[part] ?? true
    }
    onChange({ [part]: all } as Partial<UserData>, part, fromCache)
  }

  const dropCar = (carId: string, entry: CarListeners) => {
    entry.unsubs.forEach(u => u())
    perCar.delete(carId)
  }

  const listenCar = (carId: string) => {
    const entry: CarListeners = { unsubs: [], docs: {}, fromCache: {} }
    perCar.set(carId, entry)
    for (const part of RELATED) {
      const map = CAR_PART_MAPPERS[part]
      entry.unsubs.push(
        onSnapshot(
          carCol(carId, part),
          snap => {
            if (perCar.get(carId) !== entry) return
            entry.docs[part] = snap.docs.map(map)
            entry.fromCache[part] = snap.metadata.fromCache
            publish(part)
          },
          e => {
            if (perCar.get(carId) !== entry) return
            if ((e as { code?: string }).code === 'permission-denied' && entry.docs[part]) {
              dropCar(carId, entry)
              revoked.add(carId)
              RELATED.forEach(publish)
              return
            }
            onError(e)
          },
        ),
      )
    }
  }

  subs.push(
    onSnapshot(
      query(carsCol(), where('ownerUid', '==', uid)),
      snap => {
        const ids = snap.docs.map(d => d.id)
        for (const [carId, entry] of perCar) {
          if (!ids.includes(carId)) dropCar(carId, entry)
        }
        for (const carId of revoked) if (!ids.includes(carId)) revoked.delete(carId)
        for (const carId of ids) if (!perCar.has(carId) && !revoked.has(carId)) listenCar(carId)

        const idsKey = [...ids].sort().join(',')
        const changed = !carsReady || idsKey !== carIdsKey || snap.metadata.fromCache !== carsFromCache
        carsReady = true
        carIdsKey = idsKey
        carsFromCache = snap.metadata.fromCache
        onChange({ cars: snap.docs.map(carFrom) }, 'cars', snap.metadata.fromCache)
        if (changed) RELATED.forEach(publish)
      },
      onError,
    ),
  )
  return () => {
    subs.forEach(u => u())
    perCar.forEach(entry => entry.unsubs.forEach(u => u()))
    perCar.clear()
    revoked.clear()
  }
}

/**
 * Registra una lectura del odómetro y, si es la más alta, actualiza el km actual del auto
 * y recalcula el promedio diario.
 */
function addReadingToBatch(
  batch: WriteBatch,
  actor: Actor,
  car: Car,
  readings: OdometerReading[],
  km: number,
  source: OdometerSource,
  date = new Date(),
) {
  const id = newChildId(car.id, 'odometer')
  batch.set(doc(carCol(car.id, 'odometer'), id), {
    carId: car.id,
    km,
    date: Timestamp.fromDate(date),
    source,
    createdBy: actor.uid,
    createdByName: actor.name,
  })
  if (km >= car.currentKm) {
    const carReadings = readings.filter(r => r.carId === car.id).concat({ id, carId: car.id, km, date, source })
    batch.update(carDoc(car.id), {
      currentKm: km,
      kmUpdatedAt: Timestamp.fromDate(date),
      avgKmPerDay: computeAvgKmPerDay(carReadings),
    })
  }
}

export async function recordKm(actor: Actor, car: Car, readings: OdometerReading[], km: number) {
  const batch = writeBatch(firestore())
  addReadingToBatch(batch, actor, car, readings, km, 'manual')
  await batch.commit()
}

/** Km actual del auto a partir de sus lecturas (de un solo auto): la más alta manda. */
export function carKmFrom(readings: OdometerReading[]) {
  const top = topReading(readings)
  return {
    currentKm: top?.km ?? 0,
    kmUpdatedAt: top ? Timestamp.fromDate(top.date) : null,
    avgKmPerDay: computeAvgKmPerDay(readings),
  }
}

/**
 * Corrige el km guardado en el auto con sus lecturas. Hace falta porque se escribe desde el cliente
 * con lo que el dispositivo tenía en memoria (una carga offline o dos dispositivos cruzados pueden
 * dejarlo viejo), y el cron lo lee de ahí para los vencimientos por km.
 */
export async function syncCarKm(actor: Actor, carId: string, readings: OdometerReading[]) {
  const carReadings = readings.filter(r => r.carId === carId)
  if (!carReadings.length) return
  const batch = writeBatch(firestore())
  batch.update(carDoc(carId), carKmFrom(carReadings))
  await batch.commit()
}

/** Borra una lectura (para corregir un error de tipeo) y recalcula el km actual con las que quedan. */
export async function deleteReading(actor: Actor, car: Car, readings: OdometerReading[], readingId: string) {
  const remaining = readings.filter(r => r.carId === car.id && r.id !== readingId)
  if (!remaining.length) throw new Error('No podés borrar el único registro de km del auto.')
  const batch = writeBatch(firestore())
  batch.delete(doc(carCol(car.id, 'odometer'), readingId))
  batch.update(carDoc(car.id), carKmFrom(remaining))
  await batch.commit()
}

/** Vuelve a poner una lectura borrada ("Deshacer") con su autoría original y recalcula el km actual. */
export async function restoreReading(actor: Actor, car: Car, readings: OdometerReading[], reading: OdometerReading) {
  const all = readings.filter(r => r.carId === car.id && r.id !== reading.id).concat(reading)
  const batch = writeBatch(firestore())
  batch.set(doc(carCol(car.id, 'odometer'), reading.id), {
    carId: reading.carId,
    km: reading.km,
    date: Timestamp.fromDate(reading.date),
    source: reading.source,
    ...authorOf(reading, actor),
  })
  batch.update(carDoc(car.id), carKmFrom(all))
  await batch.commit()
}

export type CarInput = Pick<Car, 'brand' | 'model' | 'version' | 'year' | 'plate' | 'fuelTypes'> & {
  photoUrl?: string | null
  photoPublicId?: string | null
}

/** Crea el auto con su dueño (`members` arranca vacío) y la lectura inicial de km, en un mismo batch. */
export async function createCar(actor: Actor, data: CarInput, initialKm: number, carId = newCarId()) {
  const now = new Date()
  const batch = writeBatch(firestore())
  batch.set(carDoc(carId), {
    ...data,
    ownerUid: actor.uid,
    ownerName: actor.name,
    members: [],
    currentKm: initialKm,
    kmUpdatedAt: Timestamp.fromDate(now),
    avgKmPerDay: null,
    createdAt: Timestamp.fromDate(now),
  })
  batch.set(doc(carCol(carId, 'odometer')), {
    carId,
    km: initialKm,
    date: Timestamp.fromDate(now),
    source: 'initial',
    createdBy: actor.uid,
    createdByName: actor.name,
  })
  await batch.commit()
  return carId
}

export async function updateCar(actor: Actor, carId: string, data: Partial<CarInput>) {
  const batch = writeBatch(firestore())
  batch.update(carDoc(carId), data)
  await batch.commit()
}

/** Borra en tandas de 450: un batch admite hasta 500 operaciones. */
async function deleteRefs(refs: ReturnType<typeof doc>[]) {
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(firestore())
    refs.slice(i, i + 450).forEach(r => batch.delete(r))
    await batch.commit()
  }
}

/**
 * Borra el auto y todo lo asociado (mantenimientos, trabajos, cargas y lecturas).
 * Los hijos van antes que el auto: las reglas deciden el permiso de un hijo con el documento del auto, así
 * que sin el auto ya no se pueden leer ni borrar, y quedarían huérfanos. Primero borra lo que la app ya
 * tiene en memoria, después barre en el servidor lo que pudiera haber quedado (por ejemplo, cargado desde
 * otro dispositivo) y por último borra el auto, que recién ahí desaparece de la pantalla.
 */
export async function deleteCar(actor: Actor, carId: string, known: Partial<Record<RelatedName, string[]>> = {}) {
  await deleteRefs(RELATED.flatMap(name => (known[name] ?? []).map(id => doc(carCol(carId, name), id))))
  const leftovers: ReturnType<typeof doc>[] = []
  for (const name of RELATED) {
    const snap = await getDocs(carCol(carId, name))
    leftovers.push(...snap.docs.map(d => d.ref))
  }
  if (leftovers.length) await deleteRefs(leftovers)
  await deleteRefs([carDoc(carId)])
}

export type RuleInput = Pick<
  MaintenanceRule,
  'carId' | 'name' | 'intervalKm' | 'intervalTime' | 'repeat' | 'lastDoneKm' | 'lastDoneDate' | 'warnKm' | 'warnDays'
>

/** Guarda un mantenimiento. Al editar se resetea el aviso para que vuelva a notificar con los datos nuevos. */
export async function saveRule(actor: Actor, data: RuleInput, ruleId = newChildId(data.carId, 'rules')) {
  await setDoc(doc(carCol(data.carId, 'rules'), ruleId), { ...data, lastNotifiedAt: null, lastNotifiedStatus: null })
  return ruleId
}

export async function deleteRule(actor: Actor, carId: string, ruleId: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(carCol(carId, 'rules'), ruleId))
  await batch.commit()
}

/** Vuelve a crear un mantenimiento borrado, tal cual estaba ("Deshacer"). */
export async function restoreRule(actor: Actor, rule: MaintenanceRule) {
  const { id, lastNotifiedAt, ...data } = rule
  await setDoc(doc(carCol(rule.carId, 'rules'), id), {
    ...data,
    lastNotifiedAt: lastNotifiedAt ? Timestamp.fromDate(lastNotifiedAt) : null,
  })
}

export type JobInput = Omit<Job, 'id' | 'createdAt' | 'createdBy' | 'createdByName' | 'status'>

/** "Volver al taller en…": recordatorio de una sola vez que se crea junto con un trabajo. */
export interface FollowUp {
  name: string
  intervalTime: TimeInterval
}

/**
 * Guarda un trabajo. Los mantenimientos marcados se dan por hechos en la fecha/km del trabajo
 * (sólo si es más reciente que la última vez registrada): los periódicos se reinician y los de una
 * sola vez se borran. Si el km es mayor al actual se registra, y opcionalmente agenda la vuelta al taller.
 * Al crearlo se graba quién lo cargó y el estado `approved`; al editarlo no se tocan.
 * Cada mantenimiento marcado se escribe aparte del trabajo y de los demás: si alguno ya no existe (borrado
 * en otro dispositivo) su update falla, y en un solo batch eso tiraba abajo también el trabajo.
 * Se commitea primero el trabajo (Firestore respeta el orden) y los mantenimientos no se esperan: sin
 * conexión quedaría colgado, y si alguno falla el trabajo ya está a salvo.
 */
export async function saveJob(
  actor: Actor,
  ctx: { car: Car; rules: MaintenanceRule[]; readings: OdometerReading[] },
  data: JobInput,
  jobId?: string,
  followUp?: FollowUp | null,
) {
  const carId = ctx.car.id
  const jobBatch = writeBatch(firestore())
  const id = jobId ?? newChildId(carId, 'jobs')
  const existing = jobId
    ? {}
    : { createdAt: Timestamp.now(), createdBy: actor.uid, createdByName: actor.name, status: 'approved' satisfies JobStatus }
  jobBatch.set(doc(carCol(carId, 'jobs'), id), { ...data, ...existing }, { merge: true })

  const doneKm = data.km ?? ctx.car.currentKm
  const ruleBatches: { ruleId: string; batch: WriteBatch }[] = []
  for (const rule of ctx.rules.filter(r => data.ruleIds.includes(r.id))) {
    const isNewer = !rule.lastDoneDate || data.date >= rule.lastDoneDate
    if (!isNewer) continue
    const ruleBatch = writeBatch(firestore())
    ruleBatches.push({ ruleId: rule.id, batch: ruleBatch })
    if (!rule.repeat) {
      ruleBatch.delete(doc(carCol(carId, 'rules'), rule.id))
      continue
    }
    ruleBatch.update(doc(carCol(carId, 'rules'), rule.id), {
      lastDoneKm: rule.intervalKm != null ? doneKm : rule.lastDoneKm,
      lastDoneDate: data.date,
      lastNotifiedAt: null,
      lastNotifiedStatus: null,
    })
  }
  if (followUp) {
    jobBatch.set(doc(carCol(carId, 'rules')), {
      carId,
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
    addReadingToBatch(jobBatch, actor, ctx.car, ctx.readings, data.km, 'job')
  }
  const saved = jobBatch.commit()
  for (const r of ruleBatches) {
    r.batch.commit().catch(e => console.warn('No se actualizó un mantenimiento del trabajo', id, r.ruleId, e))
  }
  await saved
  return id
}

export async function deleteJob(actor: Actor, carId: string, jobId: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(carCol(carId, 'jobs'), jobId))
  await batch.commit()
}

/**
 * Vuelve a crear un trabajo borrado ("Deshacer") con su autoría y estado originales. Borrarlo no había
 * tocado mantenimientos ni km.
 */
export async function restoreJob(actor: Actor, job: Job) {
  const { id, createdAt, createdBy, createdByName, status, ...data } = job
  await setDoc(doc(carCol(job.carId, 'jobs'), id), {
    ...data,
    ...authorOf(job, actor),
    status: status ?? 'approved',
    createdAt: Timestamp.fromDate(createdAt),
  })
}

export type FuelInput = Omit<FuelLoad, 'id' | 'createdAt' | 'createdBy' | 'createdByName'>

export async function saveFuel(
  actor: Actor,
  ctx: { car: Car; readings: OdometerReading[] },
  data: FuelInput,
  fuelId?: string,
) {
  const carId = ctx.car.id
  const batch = writeBatch(firestore())
  const id = fuelId ?? newChildId(carId, 'fuel')
  const existing = fuelId ? {} : { createdAt: Timestamp.now(), createdBy: actor.uid, createdByName: actor.name }
  batch.set(doc(carCol(carId, 'fuel'), id), { ...data, ...existing }, { merge: true })
  if (data.km != null && data.km > ctx.car.currentKm) {
    addReadingToBatch(batch, actor, ctx.car, ctx.readings, data.km, 'fuel')
  }
  await batch.commit()
  return id
}

export async function deleteFuel(actor: Actor, carId: string, fuelId: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(carCol(carId, 'fuel'), fuelId))
  await batch.commit()
}

/** Vuelve a crear una carga borrada ("Deshacer") con su autoría original. */
export async function restoreFuel(actor: Actor, load: FuelLoad) {
  const { id, createdAt, createdBy, createdByName, ...data } = load
  await setDoc(doc(carCol(load.carId, 'fuel'), id), {
    ...data,
    ...authorOf(load, actor),
    createdAt: Timestamp.fromDate(createdAt),
  })
}

export async function saveSettings(uid: string, settings: Partial<UserSettings>) {
  await setDoc(userDoc(uid), settings, { merge: true })
}

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function savePushSubscription(uid: string, sub: PushSubscriptionJSON) {
  const id = await sha256(sub.endpoint!)
  await setDoc(doc(userCol(uid, 'pushSubscriptions'), id), {
    endpoint: sub.endpoint,
    keys: sub.keys,
    userAgent: navigator.userAgent,
    createdAt: Timestamp.now(),
  })
}

export async function deletePushSubscription(uid: string, endpoint: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(userCol(uid, 'pushSubscriptions'), await sha256(endpoint)))
  await batch.commit()
}

/**
 * Guarda los logros conseguidos. Es idempotente: el id del documento es el del logro y la transacción
 * sólo crea los que no existen, así un reintento, un doble evento u otro dispositivo al mismo tiempo
 * no lo duplican ni pisan la fecha original. Necesita conexión (si falla, se reintenta más tarde).
 * Devuelve cuántos creó.
 */
export async function unlockAchievements(uid: string, unlocks: { id: string; carId: string | null }[]) {
  if (!unlocks.length) return 0
  return runTransaction(firestore(), async tx => {
    const refs = unlocks.map(u => doc(userCol(uid, 'achievements'), u.id))
    const snaps = await Promise.all(refs.map(r => tx.get(r)))
    const now = Timestamp.now()
    let created = 0
    snaps.forEach((snap, i) => {
      if (snap.exists()) return
      tx.set(refs[i], { carId: unlocks[i].carId, unlockedAt: now, celebratedAt: null })
      created++
    })
    return created
  })
}

/** La celebración ya se mostró (o el usuario la cerró): no vuelve a aparecer en ningún dispositivo. */
export async function markAchievementsCelebrated(uid: string, ids: string[]) {
  if (!ids.length) return
  const batch = writeBatch(firestore())
  const now = Timestamp.now()
  ids.forEach(id => batch.update(doc(userCol(uid, 'achievements'), id), { celebratedAt: now }))
  await batch.commit()
}
