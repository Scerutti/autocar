'use client'

import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot,
  type Unsubscribe,
  type WriteBatch,
} from 'firebase/firestore'
import { firestore } from './firebase/client'
import { toISODate } from './dates'
import { defaultWarnings, jobChangeDiff, projectionPatch, projectRule, type ProjectionChange } from './maintenance'
import { carKmFrom, linkedReadingId, readingDateOf, withLinkedReading, type LinkedSource } from './odometer'
import { fuelTypeFromDoc, fuelTypesFromDoc, gradeFromDoc, intervalFromDoc } from './parse'
import {
  canonicalEmail,
  INVITE_DAYS,
  inviteCarLabel,
  inviteId,
  isApproved,
  jobEdit,
  normalizeEmail,
  reviewAlreadyDone,
  transferPatch,
  type CarMember,
  type ReviewTarget,
} from './sharing'
import {
  DEFAULT_SETTINGS,
  isLiquidFuel,
  type Actor,
  type AchievementRecord,
  type Car,
  type FuelLoad,
  type Invite,
  type InviteStatus,
  type ISODate,
  type Job,
  type JobStatus,
  type MaintenanceRule,
  type MemberProfile,
  type OdometerReading,
  type TimeInterval,
  type UserSettings,
} from './types'
import { changedFields, isUnchanged } from './utils'

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
const invitesCol = () => collection(firestore(), 'invites')
const inviteDoc = (id: string) => doc(invitesCol(), id)

type UserCollectionName = 'pushSubscriptions' | 'achievements'
type RelatedName = 'rules' | 'jobs' | 'fuel' | 'odometer'

const RELATED: readonly RelatedName[] = ['rules', 'jobs', 'fuel', 'odometer']

/** Id para un auto nuevo: el formulario lo necesita antes de crearlo, porque la foto se sube con ese id. */
export const newCarId = () => doc(carsCol()).id

const newChildId = (carId: string, name: RelatedName) => doc(carCol(carId, name)).id

/** Quién figura como autor de un registro: `createdBy` y `createdByName` tal como se guardan. */
type Author = { createdBy: string; createdByName: string | null }

/**
 * Autoría de un registro que se vuelve a escribir ("Deshacer", o la lectura de km de una carga o un trabajo):
 * conserva la original y, si falta (un registro nuevo o uno viejo sin autoría), usa la de `actor`.
 */
function authorOf(item: { createdBy?: string | null; createdByName?: string | null }, actor: Actor): Author {
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

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((m: unknown): m is string => typeof m === 'string') : [])

/** Perfiles de los miembros (`memberProfiles`): se descarta lo que no es un mapa. */
function profilesFrom(v: unknown): Record<string, MemberProfile> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, MemberProfile> = {}
  for (const [uid, p] of Object.entries(v as Record<string, unknown>)) {
    if (!p || typeof p !== 'object') continue
    const x = p as Record<string, unknown>
    out[uid] = { email: str(x.email) ?? '', name: str(x.name) }
  }
  return out
}

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
    ownerUid: str(x.ownerUid) ?? '',
    ownerName: str(x.ownerName),
    members: strings(x.members),
    memberUids: strings(x.memberUids),
    memberProfiles: profilesFrom(x.memberProfiles),
  }
}

const INVITE_STATUSES: readonly InviteStatus[] = ['pending', 'accepted', 'declined', 'revoked']

/** Una invitación como la usa la app. Un estado que no se conoce cuenta como cancelada. */
function inviteFrom(id: string, x: DocumentData): Invite {
  return {
    id,
    carId: x.carId ?? '',
    ownerUid: x.ownerUid ?? '',
    ownerName: str(x.ownerName),
    carLabel: x.carLabel ?? '',
    email: x.email ?? '',
    emailKey: x.emailKey ?? '',
    status: INVITE_STATUSES.includes(x.status) ? x.status : 'revoked',
    createdAt: toDate(x.createdAt) ?? new Date(0),
    expiresAt: toDate(x.expiresAt) ?? new Date(0),
    respondedAt: toDate(x.respondedAt),
    acceptedUid: str(x.acceptedUid),
  }
}

/**
 * Lectura tolerante de un mantenimiento. Si el documento no tiene los campos de la base (lo creó o lo editó la versión
 * anterior de la PWA, que reescribe el documento completo), la base es la "última vez" guardada (`lastDone*`). Si los
 * tiene en null, la base es null: la explica un trabajo (`scripts/rebase-rules.mjs`).
 */
function ruleFrom(d: QueryDocumentSnapshot<DocumentData>): MaintenanceRule {
  const x = d.data()
  const legacy = !('baseDate' in x)
  return {
    id: d.id,
    carId: x.carId,
    name: x.name ?? '',
    intervalKm: num(x.intervalKm),
    intervalTime: intervalFromDoc(x),
    repeat: x.repeat !== false,
    baseKm: num(legacy ? x.lastDoneKm : x.baseKm),
    baseDate: str(legacy ? x.lastDoneDate : x.baseDate),
    lastDoneKm: num(x.lastDoneKm),
    lastDoneKmEstimated: x.lastDoneKmEstimated === true,
    lastDoneDate: str(x.lastDoneDate),
    lastDoneJobId: str(x.lastDoneJobId),
    completedByJobId: str(x.completedByJobId),
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
    reviewedAt: toDate(x.reviewedAt),
    revision: num(x.revision) ?? 0,
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
    sourceId: str(x.sourceId),
    createdBy: str(x.createdBy),
    createdByName: str(x.createdByName),
    createdAt: toDate(x.createdAt),
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
  /** Las invitaciones que mandé como dueño, en cualquier estado. */
  invites: Invite[]
  /** Las invitaciones pendientes para mi mail (`emailKey`); pueden estar vencidas. */
  myInvites: Invite[]
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

/** Una de las tres consultas de autos (los míos, los compartidos por uid y por el mail viejo), con su última foto. */
interface CarQuery {
  ready: boolean
  fromCache: boolean
  docs: QueryDocumentSnapshot<DocumentData>[]
}

/**
 * Escucha en tiempo real los ajustes y todas las colecciones del usuario. En `onChange`, `fromCache`
 * indica que la foto sale de la caché local y puede no tener lo último del servidor. En el primer
 * ingreso crea el documento del usuario con la configuración por defecto (lo necesita el cron).
 *
 * Los autos salen de tres consultas, las que pide la regla de lectura: los míos (`ownerUid`), los que me
 * compartieron por invitación (`memberUids` contiene mi uid) y, hasta #66, los compartidos por el mail viejo
 * (`members` contiene mi mail en minúscula; sin `email` no se abre). La lista de autos es la unión por id, y sale
 * cuando las tres entregaron su primera foto. Si una de compartidos falla con `permission-denied` (la app publicada
 * antes que las reglas nuevas), cuenta como "sin autos compartidos" y no como un error.
 *
 * Las invitaciones salen de dos consultas: las que mandé como dueño (`ownerUid`, parte `invites`) y las pendientes
 * para mi mail canónico (`emailKey` y `status == 'pending'`, parte `myInvites`; sin `email`, vacía). Si fallan con
 * `permission-denied` (reglas sin publicar), cuentan como vacías.
 *
 * Cada auto abre 4 listeners propios, que se abren y se cierran cuando el auto aparece
 * o desaparece. `onChange` sigue recibiendo una parte por colección: la de los mantenimientos, trabajos,
 * cargas y lecturas sale cuando todos los autos actuales entregaron su primera foto (enseguida si no hay
 * autos), y `fromCache` es true si alguna de esas fotos, o alguna de las consultas de autos, salió de la
 * caché. Si a un auto que ya había entregado datos se le revoca el acceso (`permission-denied`, por ejemplo
 * porque se borró desde otro dispositivo o el dueño me sacó), se lo da de baja sin avisar un error: la
 * pantalla de error queda para los fallos reales.
 */
export function subscribeUserData(
  uid: string,
  email: string | null,
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

  const owned: CarQuery = { ready: false, fromCache: true, docs: [] }
  const byUid: CarQuery = { ready: false, fromCache: true, docs: [] }
  const byMail: CarQuery = { ready: !email, fromCache: false, docs: [] }
  const carQueries = [owned, byUid, byMail]

  const publishCars = () => {
    if (carQueries.some(q => !q.ready)) return
    const byId = new Map(carQueries.flatMap(q => q.docs).map(d => [d.id, d]))
    const ids = [...byId.keys()]
    for (const [carId, entry] of perCar) {
      if (!ids.includes(carId)) dropCar(carId, entry)
    }
    for (const carId of revoked) if (!ids.includes(carId)) revoked.delete(carId)
    for (const carId of ids) if (!perCar.has(carId) && !revoked.has(carId)) listenCar(carId)

    const fromCache = carQueries.some(q => q.fromCache)
    const idsKey = [...ids].sort().join(',')
    const changed = !carsReady || idsKey !== carIdsKey || fromCache !== carsFromCache
    carsReady = true
    carIdsKey = idsKey
    carsFromCache = fromCache
    onChange({ cars: [...byId.values()].map(carFrom) }, 'cars', fromCache)
    if (changed) RELATED.forEach(publish)
  }

  const listenCars = (target: CarQuery, q: Query<DocumentData>, onFail: (e: Error) => void) =>
    onSnapshot(
      q,
      snap => {
        target.ready = true
        target.fromCache = snap.metadata.fromCache
        target.docs = snap.docs
        publishCars()
      },
      onFail,
    )

  const sharedFailed = (target: CarQuery) => (e: Error) => {
    if ((e as { code?: string }).code !== 'permission-denied') return onError(e)
    console.warn('No se pudieron leer los autos compartidos; se sigue sin ellos', e)
    target.ready = true
    target.fromCache = false
    target.docs = []
    publishCars()
  }

  subs.push(listenCars(owned, query(carsCol(), where('ownerUid', '==', uid)), onError))
  subs.push(listenCars(byUid, query(carsCol(), where('memberUids', 'array-contains', uid)), sharedFailed(byUid)))
  if (email) {
    subs.push(listenCars(byMail, query(carsCol(), where('members', 'array-contains', email)), sharedFailed(byMail)))
  }

  const listenInvites = (part: 'invites' | 'myInvites', q: Query<DocumentData>) =>
    onSnapshot(
      q,
      snap =>
        onChange({ [part]: snap.docs.map(d => inviteFrom(d.id, d.data())) } as Partial<UserData>, part, snap.metadata.fromCache),
      e => {
        if ((e as { code?: string }).code !== 'permission-denied') return onError(e)
        console.warn('No se pudieron leer las invitaciones; se sigue sin ellas', e)
        onChange({ [part]: [] } as Partial<UserData>, part, false)
      },
    )

  subs.push(listenInvites('invites', query(invitesCol(), where('ownerUid', '==', uid))))
  if (email) {
    subs.push(
      listenInvites(
        'myInvites',
        query(invitesCol(), where('emailKey', '==', canonicalEmail(email)), where('status', '==', 'pending')),
      ),
    )
  } else {
    onChange({ myInvites: [] }, 'myInvites', false)
  }
  return () => {
    subs.forEach(u => u())
    perCar.forEach(entry => entry.unsubs.forEach(u => u()))
    perCar.clear()
    revoked.clear()
  }
}

/** Los campos de una lectura como se guardan en Firestore (el id es el del documento). */
function readingData(r: Omit<OdometerReading, 'id'>) {
  return {
    carId: r.carId,
    km: r.km,
    date: Timestamp.fromDate(r.date),
    source: r.source,
    sourceId: r.sourceId,
    createdBy: r.createdBy ?? null,
    createdByName: r.createdByName ?? null,
    createdAt: r.createdAt ? Timestamp.fromDate(r.createdAt) : null,
  }
}

/** Km del auto como se guarda en su documento (`kmUpdatedAt` como Timestamp), a partir de las lecturas de ese auto. */
function carKmUpdate(readings: OdometerReading[]) {
  const km = carKmFrom(readings)
  return { ...km, kmUpdatedAt: km.kmUpdatedAt ? Timestamp.fromDate(km.kmUpdatedAt) : null }
}

/**
 * Registra una lectura manual del odómetro (id al azar, sin `sourceId`, `createdAt` = ahora) y recalcula el km
 * actual del auto y el promedio diario con las lecturas del auto más la nueva (`carKmFrom`: una lectura con fecha
 * pasada y menos km no lo baja).
 */
function addManualReading(batch: WriteBatch, actor: Actor, car: Car, readings: OdometerReading[], km: number, date: Date) {
  const id = newChildId(car.id, 'odometer')
  const reading: OdometerReading = {
    id,
    carId: car.id,
    km,
    date,
    source: 'manual',
    sourceId: null,
    createdBy: actor.uid,
    createdByName: actor.name,
    createdAt: new Date(),
  }
  batch.set(doc(carCol(car.id, 'odometer'), id), readingData(reading))
  batch.update(carDoc(car.id), carKmUpdate(readings.filter(r => r.carId === car.id).concat(reading)))
}

/**
 * Carga los km del tablero en una fecha (validar antes con `validateKmReading`). Con la fecha de hoy la lectura
 * lleva la hora actual; con una fecha pasada, el mediodía de ese día (`readingDateOf`), como las vinculadas.
 */
export async function recordKm(actor: Actor, car: Car, readings: OdometerReading[], km: number, date: ISODate) {
  const now = new Date()
  const batch = writeBatch(firestore())
  addManualReading(batch, actor, car, readings, km, date === toISODate(now) ? now : readingDateOf(date))
  await batch.commit()
}

/** El auto y las lecturas que tiene la app (de todos los autos o sólo de ése): lo que hace falta para recalcular su km. */
type KmContext = { car: Car; readings: OdometerReading[] }

/** La carga o el trabajo del que sale una lectura vinculada. */
type ReadingLink = { source: LinkedSource; sourceId: string }

/** Lo que la lectura vinculada toma de su registro: la fecha, el km (null = sin lectura) y el autor del registro. */
type LinkedEntry = { date: ISODate; km: number | null; author: Author }

/**
 * Pone, cambia o saca la lectura de km de una carga o un trabajo (id `fuel-{id}` o `job-{id}`, `linkedReadingId`)
 * y recalcula el km del auto en el mismo batch.
 * - Con km: la escribe siempre, aunque sea menor al km actual (es un punto real de la serie y el km del auto lo
 *   define la lectura más alta), con la fecha del registro al mediodía y a nombre del autor del registro: así, si
 *   el dueño edita la carga de un miembro, `createdBy` no cambia y la regla de `update` lo acepta. `createdAt`
 *   conserva el de la lectura que pisa, si la app la tiene, y si no es ahora.
 * - Sin km, o con `entry` null (se borra el registro): borra la lectura. Si no existía, el borrado no tiene efecto
 *   y las reglas lo aceptan.
 * El km del auto sale de las lecturas que quedan, así que puede bajar (corregir un error de tipeo). Si la lista no
 * cambia (no había lectura y no se escribe una) o queda vacía, no toca el auto. Devuelve las lecturas del auto
 * después del cambio.
 */
function writeLinkedReading(batch: WriteBatch, ctx: KmContext, link: ReadingLink, entry: LinkedEntry | null): OdometerReading[] {
  const carId = ctx.car.id
  const id = linkedReadingId(link.source, link.sourceId)
  const ref = doc(carCol(carId, 'odometer'), id)
  const carReadings = ctx.readings.filter(r => r.carId === carId)
  const next: OdometerReading | null =
    entry && entry.km != null
      ? {
          id,
          carId,
          km: entry.km,
          date: readingDateOf(entry.date),
          source: link.source,
          sourceId: link.sourceId,
          ...entry.author,
          createdAt: carReadings.find(r => r.id === id)?.createdAt ?? new Date(),
        }
      : null
  if (next) batch.set(ref, readingData(next))
  else batch.delete(ref)
  if (!next && !carReadings.some(r => r.id === id)) return carReadings
  const after = withLinkedReading(carReadings, id, next)
  if (after.length) batch.update(carDoc(carId), carKmUpdate(after))
  return after
}

/**
 * Corrige el km guardado en el auto con sus lecturas (`carKmFrom`): lo sube o lo baja a la más alta. Hace falta
 * porque se escribe desde el cliente con lo que el dispositivo tenía en memoria (una carga offline, dos dispositivos
 * cruzados o un miembro pueden dejarlo mal). La app y el cron toman el km de la lectura más alta, pero
 * `avgKmPerDay` sale de lo guardado y las versiones anteriores de la PWA leen `currentKm`. Lo llama `DataProvider`
 * cuando `kmCorrection` dice que hay algo que corregir.
 */
export async function syncCarKm(actor: Actor, carId: string, readings: OdometerReading[]) {
  const carReadings = readings.filter(r => r.carId === carId)
  if (!carReadings.length) return
  const batch = writeBatch(firestore())
  batch.update(carDoc(carId), carKmUpdate(carReadings))
  await batch.commit()
}

/**
 * Borra una lectura sin `sourceId` (para corregir un error de tipeo) y recalcula el km actual con las que quedan.
 * La de una carga o un trabajo no se borra acá: se corrige editando o borrando ese registro.
 */
export async function deleteReading(actor: Actor, car: Car, readings: OdometerReading[], readingId: string) {
  const carReadings = readings.filter(r => r.carId === car.id)
  if (carReadings.find(r => r.id === readingId)?.sourceId) {
    throw new Error('Este registro sale de una carga o un trabajo: corregilo desde ahí.')
  }
  const remaining = carReadings.filter(r => r.id !== readingId)
  if (!remaining.length) throw new Error('No podés borrar el único registro de km del auto.')
  const batch = writeBatch(firestore())
  batch.delete(doc(carCol(car.id, 'odometer'), readingId))
  batch.update(carDoc(car.id), carKmUpdate(remaining))
  await batch.commit()
}

/** Vuelve a poner una lectura sin `sourceId` borrada ("Deshacer") con su autoría original y recalcula el km actual. */
export async function restoreReading(actor: Actor, car: Car, readings: OdometerReading[], reading: OdometerReading) {
  const all = withLinkedReading(readings.filter(r => r.carId === car.id), reading.id, reading)
  const batch = writeBatch(firestore())
  batch.set(doc(carCol(car.id, 'odometer'), reading.id), readingData({ ...reading, ...authorOf(reading, actor) }))
  batch.update(carDoc(car.id), carKmUpdate(all))
  await batch.commit()
}

export type CarInput = Pick<Car, 'brand' | 'model' | 'version' | 'year' | 'plate' | 'fuelTypes'> & {
  photoUrl?: string | null
  photoPublicId?: string | null
}

/** Crea el auto con su dueño (sin miembros) y la lectura inicial de km, en un mismo batch. */
export async function createCar(actor: Actor, data: CarInput, initialKm: number, carId = newCarId()) {
  const now = new Date()
  const batch = writeBatch(firestore())
  batch.set(carDoc(carId), {
    ...data,
    ownerUid: actor.uid,
    ownerName: actor.name,
    members: [],
    memberUids: [],
    memberProfiles: {},
    currentKm: initialKm,
    kmUpdatedAt: Timestamp.fromDate(now),
    avgKmPerDay: null,
    createdAt: Timestamp.fromDate(now),
  })
  batch.set(
    doc(carCol(carId, 'odometer')),
    readingData({
      carId,
      km: initialKm,
      date: now,
      source: 'initial',
      sourceId: null,
      createdBy: actor.uid,
      createdByName: actor.name,
      createdAt: now,
    }),
  )
  await batch.commit()
  return carId
}

export async function updateCar(actor: Actor, carId: string, data: Partial<CarInput>) {
  const batch = writeBatch(firestore())
  batch.update(carDoc(carId), data)
  await batch.commit()
}

/**
 * Invita a un mail a compartir el auto (lo hace el dueño; validar antes con `memberError`): `set` de
 * `invites/{carId}_{mail canónico}` pendiente, que vence a los `INVITE_DAYS` días. El id es fijo: volver a invitar a
 * un mail cuya invitación venció, se rechazó, se canceló o ya no es miembro pisa la anterior (las reglas deciden cuándo
 * se puede). El auto no le aparece al invitado hasta que acepta.
 */
export async function inviteMember(actor: Actor, car: Car, email: string) {
  const mail = normalizeEmail(email)
  const now = new Date()
  const batch = writeBatch(firestore())
  batch.set(inviteDoc(inviteId(car.id, mail)), {
    carId: car.id,
    ownerUid: actor.uid,
    ownerName: actor.name,
    carLabel: inviteCarLabel(car),
    email: mail,
    emailKey: canonicalEmail(mail),
    status: 'pending',
    createdAt: Timestamp.fromDate(now),
    expiresAt: Timestamp.fromDate(new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000)),
    respondedAt: null,
    acceptedUid: null,
  })
  await batch.commit()
}

/** El dueño cancela una invitación pendiente: el link deja de servir. */
export async function revokeInvite(actor: Actor, invite: Invite) {
  const batch = writeBatch(firestore())
  batch.update(inviteDoc(invite.id), { status: 'revoked' })
  await batch.commit()
}

/**
 * Lee una invitación (la página del link). null si no existe. Si es para otra cuenta, las reglas la deniegan y tira
 * un `FirebaseError` con `code: 'permission-denied'`.
 */
export async function getInvite(id: string): Promise<Invite | null> {
  const snap = await getDoc(inviteDoc(id))
  return snap.exists() ? inviteFrom(snap.id, snap.data()) : null
}

/**
 * El invitado acepta: en un mismo batch la invitación queda `accepted` con su uid, y el auto suma su uid a
 * `memberUids` y su perfil (`email`: el mail de su login en minúscula; su nombre) a `memberProfiles`. Las reglas
 * exigen las dos escrituras juntas.
 */
export async function acceptInvite(actor: Actor, invite: Invite, email: string | null) {
  const batch = writeBatch(firestore())
  batch.update(inviteDoc(invite.id), { status: 'accepted', acceptedUid: actor.uid, respondedAt: serverTimestamp() })
  batch.update(carDoc(invite.carId), {
    memberUids: arrayUnion(actor.uid),
    [`memberProfiles.${actor.uid}`]: { email: email ? normalizeEmail(email) : invite.email, name: actor.name },
  })
  await batch.commit()
}

/** El invitado rechaza: la invitación queda `declined` y el dueño la puede volver a mandar. */
export async function declineInvite(actor: Actor, invite: Invite) {
  const batch = writeBatch(firestore())
  batch.update(inviteDoc(invite.id), { status: 'declined', acceptedUid: actor.uid, respondedAt: serverTimestamp() })
  await batch.commit()
}

/**
 * El dueño saca a un miembro: su uid de `memberUids`, su perfil de `memberProfiles` y los mails viejos de `members`
 * que son suyos (comparados con `canonicalEmail`). Un miembro sólo por el mail viejo (`uid` null) sale de `members`.
 * Va con arrayRemove y no con la lista que tiene la app, así un cambio hecho en otro dispositivo no se pisa.
 */
export async function removeMember(actor: Actor, car: Car, member: CarMember) {
  const key = canonicalEmail(member.email)
  const mails = [member.email, ...(car.members ?? []).filter(m => canonicalEmail(m) === key)]
  const batch = writeBatch(firestore())
  batch.update(
    carDoc(car.id),
    member.uid
      ? { memberUids: arrayRemove(member.uid), [`memberProfiles.${member.uid}`]: deleteField(), members: arrayRemove(...mails) }
      : { members: arrayRemove(...mails) },
  )
  await batch.commit()
}

/**
 * El miembro sale de un auto compartido. Si entró por invitación saca su uid, su perfil y, si está, su mail viejo
 * (`email`, el del login en minúscula); si sólo está por el mail viejo, saca el mail. Lo que cargó queda en el auto.
 */
export async function leaveCar(actor: Actor, car: Car, email: string | null) {
  const mail = email ? { members: arrayRemove(normalizeEmail(email)) } : {}
  const batch = writeBatch(firestore())
  batch.update(
    carDoc(car.id),
    car.memberUids?.includes(actor.uid)
      ? { memberUids: arrayRemove(actor.uid), [`memberProfiles.${actor.uid}`]: deleteField(), ...mail }
      : mail,
  )
  await batch.commit()
}

/**
 * El dueño le pasa el auto a un miembro por uid (`to.uid`; uno sólo por el mail viejo no lo puede recibir). En un mismo
 * batch, el auto cambia de dueño con `transferPatch` (el nuevo dueño sale de `memberUids`, de `memberProfiles` con
 * `deleteField()` y sus mails viejos de `members`; yo entro como miembro con mi perfil: `myEmail`, el mail de mi login,
 * y mi nombre) y se borran todas las invitaciones del auto, con cualquier estado (`ctx.invites`: las mías, de
 * `useData()`): el id de una invitación es fijo y sólo la puede volver a mandar o borrar su dueño, así que el nuevo
 * dueño no podría invitar a esos mails ni borrarlas con el auto. `memberUids` y `members` van como listas enteras, no
 * con arrayUnion/arrayRemove, porque la regla (`ownerTransfer`) compara los conjuntos.
 */
export async function transferCar(actor: Actor, ctx: { invites: Invite[] }, car: Car, to: CarMember, myEmail: string | null) {
  const patch = transferPatch(car, to, { uid: actor.uid, email: myEmail ?? '', name: actor.name })
  const profiles = Object.fromEntries(Object.entries(patch.memberProfiles).map(([uid, p]) => [`memberProfiles.${uid}`, p]))
  const batch = writeBatch(firestore())
  batch.update(carDoc(car.id), {
    ownerUid: patch.ownerUid,
    ownerName: patch.ownerName,
    memberUids: patch.memberUids,
    members: patch.members,
    ...profiles,
    [`memberProfiles.${patch.ownerUid}`]: deleteField(),
  })
  ctx.invites.filter(i => i.carId === car.id).forEach(i => batch.delete(inviteDoc(i.id)))
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
 * otro dispositivo), borra las invitaciones del auto (así a nadie le queda una pendiente de un auto que no existe) y
 * por último borra el auto, que recién ahí desaparece de la pantalla.
 */
export async function deleteCar(actor: Actor, carId: string, known: Partial<Record<RelatedName, string[]>> = {}) {
  await deleteRefs(RELATED.flatMap(name => (known[name] ?? []).map(id => doc(carCol(carId, name), id))))
  const leftovers: ReturnType<typeof doc>[] = []
  for (const name of RELATED) {
    const snap = await getDocs(carCol(carId, name))
    leftovers.push(...snap.docs.map(d => d.ref))
  }
  if (leftovers.length) await deleteRefs(leftovers)
  const invites = await getDocs(query(invitesCol(), where('ownerUid', '==', actor.uid), where('carId', '==', carId)))
  if (!invites.empty) await deleteRefs(invites.docs.map(d => d.ref))
  await deleteRefs([carDoc(carId)])
}

/** Lo que el dueño declara de un mantenimiento. La "última vez" es la base (`baseKm`, `baseDate`): nunca la proyección. */
export type RuleInput = Pick<
  MaintenanceRule,
  'carId' | 'name' | 'intervalKm' | 'intervalTime' | 'repeat' | 'baseKm' | 'baseDate' | 'warnKm' | 'warnDays'
>

/** Los trabajos y las lecturas de km que tiene la app (de todos los autos o sólo de ése): lo que usa `projectRule`. */
export type ProjectionContext = { jobs: Job[]; readings: OdometerReading[] }

/**
 * Cómo terminó un guardado: `unchanged` si al editar no había nada distinto y no se escribió nada. `settle`
 * (lib/use-saver.ts) lo pasa a `SaveStatus`, y `toastSaved` dice "Sin cambios".
 */
export type WriteOutcome = 'saved' | 'unchanged'

/**
 * Guarda un mantenimiento: lo declarado (`RuleInput`) más su proyección, calculada con la base nueva y los trabajos
 * aprobados que tiene la app (`projectRule`). Nunca escribe una "última vez" que venga del formulario. Al crear,
 * escribe el documento completo y resetea el aviso.
 * Al editar (`existing`, el mantenimiento como lo abrió el formulario, con la proyección en memoria) hace `update` sólo
 * de lo que cambió, así no pisa lo que otro dispositivo cambió mientras tanto en otros campos:
 * - De lo declarado, los campos distintos (`changedFields`). Si cambió alguno, resetea el aviso para que vuelva a
 *   notificar con los datos nuevos. Si cambió el intervalo de tiempo, borra `intervalMonths` (el formato viejo, que
 *   `intervalFromDoc` leería si el intervalo queda vacío).
 * - La proyección, sólo si no es la que tiene la app (`projectionPatch`, que dice si vuelve a avisar).
 * - La base (`baseKm` y `baseDate`) va siempre junta y con la proyección: un documento sin `baseDate` (de la versión
 *   anterior de la PWA) toma la base de `lastDone*` (`ruleFrom`), así que escribir uno solo, o la proyección sin la
 *   base, cambiaría la base que se lee.
 * Si no cambió nada, no escribe y devuelve `unchanged`. Si el mantenimiento se borró en otro dispositivo, el `update`
 * falla con `not-found` y no lo vuelve a crear. Si otro dispositivo aprobó un trabajo que la app todavía no tiene, la
 * reconciliación de `DataProvider` corrige la proyección cuando llega.
 */
export async function saveRule(actor: Actor, ctx: ProjectionContext, data: RuleInput, existing?: MaintenanceRule): Promise<WriteOutcome> {
  const id = existing?.id ?? newChildId(data.carId, 'rules')
  const declared: RuleInput = {
    carId: data.carId,
    name: data.name,
    intervalKm: data.intervalKm,
    intervalTime: data.intervalTime,
    repeat: data.repeat,
    baseKm: data.baseKm,
    baseDate: data.baseDate,
    warnKm: data.warnKm,
    warnDays: data.warnDays,
  }
  const projection = projectRule({ ...declared, id }, ctx.jobs, ctx.readings)
  const ref = doc(carCol(data.carId, 'rules'), id)
  const batch = writeBatch(firestore())
  if (!existing) {
    batch.set(ref, { ...declared, ...projection, lastNotifiedAt: null, lastNotifiedStatus: null })
  } else {
    const changed = changedFields(existing, declared)
    const patch = projectionPatch(existing, projection)
    if (isUnchanged(changed) && !patch) return 'unchanged'
    const base = 'baseKm' in changed || 'baseDate' in changed || patch ? { baseKm: declared.baseKm, baseDate: declared.baseDate } : {}
    batch.update(ref, {
      ...changed,
      ...base,
      ...patch,
      ...(isUnchanged(changed) ? {} : { lastNotifiedAt: null, lastNotifiedStatus: null }),
      ...('intervalTime' in changed ? { intervalMonths: deleteField() } : {}),
    })
  }
  await batch.commit()
  return 'saved'
}

/**
 * Guarda la proyección de un mantenimiento que no coincide con la calculada (`projectionDiff`): un batch de un
 * trabajo que falló, un cambio hecho con la versión anterior de la PWA o un km estimado que se movió con una lectura
 * nueva. Lo llama `DataProvider`, sólo en los autos propios: el plan es del dueño.
 */
export async function syncRuleProjection(actor: Actor, change: ProjectionChange) {
  const batch = writeBatch(firestore())
  batch.update(doc(carCol(change.carId, 'rules'), change.ruleId), change.patch)
  await batch.commit()
}

export async function deleteRule(actor: Actor, carId: string, ruleId: string) {
  const batch = writeBatch(firestore())
  batch.delete(doc(carCol(carId, 'rules'), ruleId))
  await batch.commit()
}

/**
 * Vuelve a crear un mantenimiento borrado, tal cual estaba ("Deshacer"): lo declarado y la proyección que tenía. Si
 * mientras tanto cambió algún trabajo, la reconciliación de `DataProvider` corrige la proyección.
 */
export async function restoreRule(actor: Actor, rule: MaintenanceRule) {
  const { id, lastNotifiedAt, ...data } = rule
  await setDoc(doc(carCol(rule.carId, 'rules'), id), {
    ...data,
    lastNotifiedAt: lastNotifiedAt ? Timestamp.fromDate(lastNotifiedAt) : null,
  })
}

export type JobInput = Omit<Job, 'id' | 'createdAt' | 'createdBy' | 'createdByName' | 'status' | 'reviewedAt' | 'revision'>

/** "Volver al taller en…": recordatorio de una sola vez que se crea junto con un trabajo. */
export interface FollowUp {
  name: string
  intervalTime: TimeInterval
}

/**
 * Lo que hace falta para guardar un trabajo: el auto, las lecturas, los mantenimientos del auto (todos, también los
 * cumplidos: borrar el trabajo que cumplió uno lo vuelve a activar) y los trabajos del auto (o de todos los autos).
 */
type JobContext = KmContext & ProjectionContext & { rules: MaintenanceRule[] }

/**
 * El camino único para crear, editar, aprobar, rechazar, borrar y restaurar un trabajo: pasa de `before` a `after`
 * (null = no existe). `writeJob` escribe el documento del trabajo (y lo que va con él) en el batch del trabajo.
 * - La lectura de km del trabajo (`job-{id}`) va en ese mismo batch (`writeLinkedReading`): si queda aprobado, se
 *   escribe a nombre de su autor (o se borra si no tiene km); si estaba aprobado y deja de estarlo, se borra. Si
 *   estaba aprobado, sigue aprobado y no le cambió ni el km ni la fecha, no se toca.
 * - Los mantenimientos que marca antes o después se recalculan con `jobChangeDiff` y se escriben sólo los que cambian,
 *   cada uno en su propio batch: si alguno ya no existe (borrado en otro dispositivo) su update falla, y en un solo
 *   batch eso tiraba abajo también el trabajo.
 * Los batches de los mantenimientos se commitean recién cuando el servidor confirma el del trabajo: si las reglas lo
 * rechazan (una aprobación de una versión vieja) o el trabajo se borró en otro dispositivo, el batch del trabajo se
 * deshace entero (también la lectura) y los mantenimientos no quedan reiniciados con un trabajo que no se guardó. Sin
 * conexión quedan para cuando llegue la confirmación, y si la app se cierra antes no se escriben. Mientras tanto la
 * pantalla muestra la proyección en memoria (`DataProvider`), y la reconciliación de `DataProvider` escribe lo que haya
 * faltado o fallado en la próxima carga confirmada por el servidor. La promesa espera sólo el batch del trabajo.
 * Ningún trabajo borra un mantenimiento: los de una sola vez quedan cumplidos (`completedByJobId`).
 */
async function applyJobChange(
  actor: Actor,
  ctx: JobContext,
  before: Job | null,
  after: Job | null,
  writeJob: (batch: WriteBatch) => void,
) {
  const job = after ?? before
  if (!job) return
  const jobBatch = writeBatch(firestore())
  writeJob(jobBatch)
  const link: ReadingLink = { source: 'job', sourceId: job.id }
  let readingsAfter: OdometerReading[] = ctx.readings
  if (after && isApproved(after)) {
    const moved = !before || !isApproved(before) || before.km !== after.km || before.date !== after.date
    if (moved) readingsAfter = writeLinkedReading(jobBatch, ctx, link, { date: after.date, km: after.km, author: authorOf(after, actor) })
  } else if (before && isApproved(before)) {
    readingsAfter = writeLinkedReading(jobBatch, ctx, link, null)
  }
  const changes = jobChangeDiff({ rules: ctx.rules, jobs: ctx.jobs, readings: ctx.readings, readingsAfter, before, after })
  const saved = jobBatch.commit()
  saved.then(
    () => {
      for (const change of changes) {
        const ruleBatch = writeBatch(firestore())
        ruleBatch.update(doc(carCol(change.carId, 'rules'), change.ruleId), change.patch)
        ruleBatch.commit().catch(e => console.warn('No se actualizó un mantenimiento del trabajo', job.id, change.ruleId, e))
      }
    },
    () => {},
  )
  await saved
}

/**
 * Guarda un trabajo (`applyJobChange` desde `existing`, el trabajo como estaba).
 * - Al crearlo, `set` del documento completo con quién lo cargó y `revision: 0`. Si lo crea el dueño queda aprobado
 *   y sus mantenimientos se recalculan; opcionalmente, agenda la vuelta al taller (`followUp`, sólo al crear). Si lo
 *   crea un miembro queda `pending` y no cambia nada más, aunque el km sea mayor al actual: los mantenimientos y el km
 *   quedan guardados en el trabajo y cuentan al aprobarlo (`approveJob`), así un trabajo rechazado no deja nada mal
 *   cargado.
 * - Al editarlo, `update` sólo de los campos que cambiaron (`changedFields`) contra `existing`, el trabajo como lo
 *   abrió el formulario: así no pisa lo que otro dispositivo cambió mientras tanto en otros campos. Suma el estado y
 *   la revisión que dice `jobEdit` con el trabajo como lo tiene la app ahora (`ctx.jobs`; si no está, `existing`):
 *   el miembro lo vuelve a `pending` y sube `revision`; el dueño no le cambia el estado. Los efectos (lectura y
 *   mantenimientos) también salen del trabajo actual con los cambios. No toca quién lo cargó. Si no cambió nada, no
 *   escribe nada (ni el trabajo, ni su lectura, ni los mantenimientos) y devuelve `unchanged`. Si el trabajo se borró
 *   en otro dispositivo, el `update` falla con `not-found` y no lo vuelve a crear.
 */
export async function saveJob(
  actor: Actor,
  ctx: JobContext,
  data: JobInput,
  existing?: Job,
  followUp?: FollowUp | null,
): Promise<WriteOutcome> {
  const carId = ctx.car.id
  const member = ctx.car.ownerUid !== actor.uid
  if (existing) {
    const current = ctx.jobs.find(j => j.id === existing.id) ?? existing
    const changes = changedFields(existing, data)
    const update = jobEdit(current, changes, member)
    if (!update) return 'unchanged'
    const after: Job = {
      ...current,
      ...changes,
      status: update.status ?? current.status,
      revision: update.revision ?? current.revision,
    }
    await applyJobChange(actor, ctx, current, after, batch => batch.update(doc(carCol(carId, 'jobs'), current.id), update))
    return 'saved'
  }
  const id = newChildId(carId, 'jobs')
  const status: JobStatus = member ? 'pending' : 'approved'
  const now = new Date()
  const after: Job = { ...data, id, status, reviewedAt: null, revision: 0, createdAt: now, createdBy: actor.uid, createdByName: actor.name }
  await applyJobChange(actor, ctx, null, after, batch => {
    batch.set(doc(carCol(carId, 'jobs'), id), {
      ...data,
      status,
      revision: 0,
      createdAt: Timestamp.fromDate(now),
      createdBy: actor.uid,
      createdByName: actor.name,
    })
    if (!followUp || status !== 'approved') return
    batch.set(doc(carCol(carId, 'rules')), {
      carId,
      name: followUp.name,
      intervalKm: null,
      intervalTime: followUp.intervalTime,
      repeat: false,
      baseKm: null,
      baseDate: data.date,
      lastDoneKm: null,
      lastDoneKmEstimated: false,
      lastDoneDate: data.date,
      lastDoneJobId: null,
      completedByJobId: null,
      ...defaultWarnings(null, followUp.intervalTime),
      lastNotifiedAt: null,
      lastNotifiedStatus: null,
    })
  })
  return 'saved'
}

/** Lo que dice el error cuando el dueño aprueba o rechaza una versión del trabajo que ya no es la guardada. */
export const REVIEW_CHANGED = 'El trabajo cambió mientras lo revisabas. Miralo de nuevo.'

/**
 * El dueño aprueba o rechaza un trabajo (`applyJobChange`): `update` del estado, `reviewedAt` y la `revision` que vio
 * (la de `job`). Las reglas sólo lo aceptan si el trabajo estaba pendiente (o, al rechazar, aprobado) y su revisión es
 * esa. Si lo rechazan (`permission-denied`), el batch del trabajo se deshace entero y los mantenimientos no se
 * escriben; entonces lee el trabajo en el servidor: si ya quedó en `target` (aprobado o rechazado dos veces, o desde
 * dos dispositivos: `reviewAlreadyDone`) termina bien, sin aplicar nada de nuevo; si no, falla con `REVIEW_CHANGED`.
 * Si tampoco lo puede leer, falla con el error original. Se lee el servidor y no los datos de la app porque, cuando
 * llega el rechazo, la caché puede no tener todavía la versión que lo causó (otro dispositivo, o la app sin conexión).
 */
async function reviewJob(actor: Actor, ctx: JobContext, job: Job, target: ReviewTarget) {
  const reviewedAt = new Date()
  const ref = doc(carCol(job.carId, 'jobs'), job.id)
  try {
    await applyJobChange(actor, ctx, job, { ...job, status: target, reviewedAt }, batch =>
      batch.update(ref, { status: target, reviewedAt: Timestamp.fromDate(reviewedAt), revision: job.revision }),
    )
  } catch (e) {
    if ((e as { code?: string }).code !== 'permission-denied') throw e
    const snap = await getDocFromServer(ref).catch(() => null)
    if (!snap) throw e
    if (reviewAlreadyDone(target, snap.exists() ? statusFrom(snap.get('status')) : null)) return
    throw new Error(REVIEW_CHANGED)
  }
}

/**
 * El dueño aprueba el trabajo de un miembro (`reviewJob`): pasa a `approved` con `reviewedAt` y sus mantenimientos se
 * recalculan con las lecturas que tiene la app del dueño en ese momento: el km del trabajo o, si no tiene, el estimado
 * a la fecha del trabajo (nunca el km de hoy). La lectura de km queda a nombre de quien cargó el trabajo.
 */
export async function approveJob(actor: Actor, ctx: JobContext, job: Job) {
  await reviewJob(actor, ctx, job, 'approved')
}

/**
 * El dueño rechaza un trabajo (`reviewJob`): queda `rejected`, y quien lo cargó lo puede corregir o borrar. Si estaba
 * aprobado, deja de contar: se borra su lectura de km (se recalcula el km del auto) y sus mantenimientos vuelven a como
 * estaban antes de él.
 */
export async function rejectJob(actor: Actor, ctx: JobContext, job: Job) {
  await reviewJob(actor, ctx, job, 'rejected')
}

/**
 * Borra un trabajo. Si estaba aprobado, se lleva su lectura de km (se recalcula el km del auto) y sus mantenimientos
 * vuelven a como estaban antes de él: al trabajo anterior o a la base; un recordatorio que había cumplido vuelve a
 * estar activo.
 */
export async function deleteJob(actor: Actor, ctx: JobContext, job: Job) {
  await applyJobChange(actor, ctx, job, null, batch => batch.delete(doc(carCol(job.carId, 'jobs'), job.id)))
}

/**
 * Vuelve a crear un trabajo borrado ("Deshacer") con su autoría, estado y revisión originales y, si estaba aprobado,
 * su lectura de km y sus mantenimientos como estaban. `ctx` puede ser el de antes de borrarlo: `jobChangeDiff` compara
 * sin el trabajo contra con el trabajo.
 */
export async function restoreJob(actor: Actor, ctx: JobContext, job: Job) {
  const { id, createdAt, createdBy, createdByName, status, reviewedAt, ...data } = job
  await applyJobChange(actor, ctx, null, job, batch =>
    batch.set(doc(carCol(job.carId, 'jobs'), id), {
      ...data,
      ...authorOf(job, actor),
      status: status ?? 'approved',
      ...(reviewedAt ? { reviewedAt: Timestamp.fromDate(reviewedAt) } : {}),
      createdAt: Timestamp.fromDate(createdAt),
    }),
  )
}

export type FuelInput = Omit<FuelLoad, 'id' | 'createdAt' | 'createdBy' | 'createdByName'>

/**
 * Guarda una carga y, en el mismo batch, su lectura de km (`fuel-{id}`, `writeLinkedReading`): si tiene km la pone
 * o la corrige, y si se le sacó el km la borra.
 * - Al crearla, `set` del documento completo con quién la cargó.
 * - Al editarla (`existing`, la carga como la abrió el formulario), `update` sólo de los campos que cambiaron
 *   (`changedFields`): dos dispositivos que cambian campos distintos no se pisan. No toca quién la cargó, y la lectura
 *   sigue a su nombre; la lectura se escribe sólo si cambió el km o la fecha. Si no cambió nada, no escribe y devuelve
 *   `unchanged`. Si la carga se borró en otro dispositivo, el `update` falla con `not-found` (el batch entero, también
 *   la lectura) y no la vuelve a crear.
 */
export async function saveFuel(actor: Actor, ctx: KmContext, data: FuelInput, existing?: FuelLoad): Promise<WriteOutcome> {
  const carId = ctx.car.id
  const batch = writeBatch(firestore())
  const entry = { date: data.date, km: data.km, author: authorOf(existing ?? {}, actor) }
  if (existing) {
    const changes = changedFields(existing, data)
    if (isUnchanged(changes)) return 'unchanged'
    batch.update(doc(carCol(carId, 'fuel'), existing.id), changes)
    if ('km' in changes || 'date' in changes) writeLinkedReading(batch, ctx, { source: 'fuel', sourceId: existing.id }, entry)
  } else {
    const id = newChildId(carId, 'fuel')
    batch.set(doc(carCol(carId, 'fuel'), id), { ...data, createdAt: Timestamp.now(), createdBy: actor.uid, createdByName: actor.name })
    writeLinkedReading(batch, ctx, { source: 'fuel', sourceId: id }, entry)
  }
  await batch.commit()
  return 'saved'
}

/** Borra una carga con su lectura de km y recalcula el km del auto. */
export async function deleteFuel(actor: Actor, ctx: KmContext, load: FuelLoad) {
  const batch = writeBatch(firestore())
  batch.delete(doc(carCol(load.carId, 'fuel'), load.id))
  writeLinkedReading(batch, ctx, { source: 'fuel', sourceId: load.id }, null)
  await batch.commit()
}

/** Vuelve a crear una carga borrada ("Deshacer") con su autoría original y su lectura de km. */
export async function restoreFuel(actor: Actor, ctx: KmContext, load: FuelLoad) {
  const { id, createdAt, createdBy, createdByName, ...data } = load
  const author = authorOf(load, actor)
  const batch = writeBatch(firestore())
  batch.set(doc(carCol(load.carId, 'fuel'), id), {
    ...data,
    ...author,
    createdAt: Timestamp.fromDate(createdAt),
  })
  writeLinkedReading(batch, ctx, { source: 'fuel', sourceId: id }, { date: load.date, km: load.km, author })
  await batch.commit()
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
