import 'server-only'
import { Timestamp, type DocumentData, type DocumentSnapshot, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import webpush from 'web-push'
import { adminDb } from './firebase/admin'
import { isPushEndpoint, type PushPayload } from './notifications'
import { fuelTypesFromDoc, intervalFromDoc } from './parse'
import {
  DEFAULT_SETTINGS,
  jobCategoryOf,
  type Car,
  type Job,
  type JobStatus,
  type MaintenanceRule,
  type MemberProfile,
  type MemberRole,
  type OdometerReading,
  type RuleNotice,
  type UserSettings,
} from './types'

let configured = false

function configure() {
  if (configured) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) throw new Error('Faltan las claves VAPID')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey)
  configured = true
}

/** Que un servicio de push colgado no frene el cron para todos. */
const SEND_TIMEOUT_MS = 10_000

/**
 * Tope de dispositivos por usuario: se usan las suscripciones más recientes y el resto se ignora, así
 * alguien con cientos de suscripciones no alarga el cron de todos. Alcanza para celular, compu y alguno más.
 */
const MAX_DEVICES_PER_USER = 5

/**
 * Tope de autos, y de mantenimientos entre todos sus autos, que se leen por usuario: nadie con datos de más alarga el
 * cron ni las rutas de avisos. De las lecturas de km se lee una por auto, así que también quedan dentro del tope.
 */
export const MAX_DOCS_PER_USER = 1000

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((m: unknown): m is string => typeof m === 'string') : [])

const MEMBER_ROLES: readonly MemberRole[] = ['editor', 'trusted', 'viewer']

function profilesFrom(v: unknown): Record<string, MemberProfile> {
  if (!v || typeof v !== 'object') return {}
  const out: Record<string, MemberProfile> = {}
  for (const [uid, p] of Object.entries(v as Record<string, unknown>)) {
    if (!p || typeof p !== 'object') continue
    const x = p as Record<string, unknown>
    const role = MEMBER_ROLES.find(r => r === x.role)
    out[uid] = { email: str(x.email) ?? '', name: str(x.name), ...(role ? { role } : {}) }
  }
  return out
}

const statusFrom = (v: unknown): JobStatus => (v === 'pending' || v === 'rejected' ? v : 'approved')

/** Un auto como lo leen el cron y las rutas de avisos, incluyendo dueño, miembros y roles. */
export function serverCarFrom(id: string, x: DocumentData): Car {
  return {
    id,
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
    memberUids: strings(x.memberUids),
    memberProfiles: profilesFrom(x.memberProfiles),
    deletedAt: toDate(x.deletedAt),
  }
}

/**
 * Un mantenimiento como lo leen el cron y `/api/notify/rules`. La base, como en `ruleFrom` de `lib/db.ts`: si el
 * documento no tiene los campos (versión anterior de la PWA), es la "última vez" guardada.
 */
export function serverRuleFrom(id: string, x: DocumentData): MaintenanceRule {
  const legacy = !('baseDate' in x)
  return {
    id,
    carId: x.carId,
    name: x.name ?? '',
    intervalKm: num(x.intervalKm),
    intervalTime: intervalFromDoc(x),
    repeat: x.repeat !== false,
    baseKm: num(legacy ? x.lastDoneKm : x.baseKm),
    baseDate: (legacy ? x.lastDoneDate : x.baseDate) ?? null,
    lastDoneKm: num(x.lastDoneKm),
    lastDoneKmEstimated: x.lastDoneKmEstimated === true,
    lastDoneDate: x.lastDoneDate ?? null,
    lastDoneJobId: x.lastDoneJobId ?? null,
    completedByJobId: x.completedByJobId ?? null,
    warnKm: num(x.warnKm) ?? 500,
    warnDays: num(x.warnDays) ?? 30,
    lastNotifiedAt: toDate(x.lastNotifiedAt),
    lastNotifiedStatus: x.lastNotifiedStatus ?? null,
  }
}

/** Un trabajo como lo leen `/api/notify/job` y `/api/notify/rules`. */
export function serverJobFrom(id: string, x: DocumentData): Job {
  return {
    id,
    carId: x.carId,
    date: x.date,
    km: num(x.km),
    title: x.title ?? '',
    category: jobCategoryOf(x.category),
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

/** Una lectura de km como la lee `/api/notify/rules` para proyectar los mantenimientos y el km del auto. */
export function serverReadingFrom(id: string, x: DocumentData): OdometerReading {
  return {
    id,
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

/** Un registro `users/{uid}/ruleNotices/{ruleId}` como lo usan el cron y `/api/notify/rules`. */
export function serverNoticeFrom(x: DocumentData): RuleNotice {
  const status = x.status === 'soon' || x.status === 'overdue' ? x.status : null
  return { status, at: toDate(x.at) }
}

/** Ajustes del usuario (`users/{uid}`) con los valores por defecto. */
export function serverSettingsFrom(x: DocumentData | undefined): UserSettings {
  return {
    reminder: { ...DEFAULT_SETTINGS.reminder, ...(x?.reminder ?? {}) },
    timezone: x?.timezone ?? DEFAULT_SETTINGS.timezone,
    sharedCars: x?.sharedCars !== false,
  }
}

/**
 * La lectura de más km de un auto: la primera ordenando por km de mayor a menor, que usa el índice simple
 * automático. null si no tiene lecturas (las que no tienen km no entran en la consulta).
 */
export async function topReadingOf(carDoc: DocumentSnapshot | QueryDocumentSnapshot) {
  const snap = await carDoc.ref.collection('odometer').orderBy('km', 'desc').limit(1).get()
  const x = snap.docs[0]?.data()
  const km = num(x?.km)
  return km == null ? null : { km, date: toDate(x?.date) }
}

/**
 * Envía los mensajes a los dispositivos del usuario y borra las suscripciones vencidas.
 * `delivered` tiene los tags de los mensajes que llegaron al menos a un dispositivo. Los mensajes a cada
 * dispositivo van en paralelo: con los mensajes topeados, un dispositivo tarda a lo sumo un timeout y no
 * uno por mensaje. Un 404/410 indica que el navegador dio de baja la suscripción y se borra; si falla el
 * borrado se sigue, porque perder `delivered` haría repetir los avisos mañana.
 */
export async function sendToUser(uid: string, messages: PushPayload[]) {
  const delivered = new Set<string>()
  if (!messages.length) return { sent: 0, devices: 0, delivered }
  configure()
  const subsRef = adminDb().collection('users').doc(uid).collection('pushSubscriptions')
  const subs = await subsRef.orderBy('createdAt', 'desc').limit(MAX_DEVICES_PER_USER).get()
  let sent = 0
  await Promise.all(
    subs.docs.map(async d => {
      const { endpoint, keys } = d.data() as { endpoint: unknown; keys: { p256dh: string; auth: string } }
      if (!isPushEndpoint(endpoint)) {
        console.warn('Suscripción push ignorada: no es de un servicio de push conocido', d.id)
        return
      }
      let gone = false
      await Promise.all(
        messages.map(async msg => {
          try {
            await webpush.sendNotification({ endpoint, keys }, JSON.stringify(msg), { TTL: 60 * 60 * 24, timeout: SEND_TIMEOUT_MS })
            sent++
            delivered.add(msg.tag)
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) {
              if (!gone) {
                gone = true
                await d.ref.delete().catch(e => console.warn('No se pudo borrar la suscripción vencida', d.id, e))
              }
              return
            }
            console.error('Error enviando push', status, (e as Error).message)
          }
        }),
      )
    }),
  )
  return { sent, devices: subs.size, delivered }
}
