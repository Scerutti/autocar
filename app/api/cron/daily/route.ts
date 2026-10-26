import { createHash, timingSafeEqual } from 'node:crypto'
import { Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { todayInTimeZone } from '@/lib/dates'
import { planDailyNotifications, updatesToPersist } from '@/lib/notifications'
import { carKmForNotifications } from '@/lib/odometer'
import { fuelTypesFromDoc, intervalFromDoc } from '@/lib/parse'
import { sendToUser } from '@/lib/push-server'
import { DEFAULT_SETTINGS, type Car, type MaintenanceRule, type UserSettings } from '@/lib/types'

export const maxDuration = 60

/**
 * Pasado este tiempo no se empiezan usuarios nuevos: los que están en curso tienen margen para
 * terminar antes de maxDuration (cada uno tarda a lo sumo un timeout de push más las lecturas).
 */
const TIME_BUDGET_MS = 40_000

/** Usuarios que se procesan a la vez: lo lento es esperar a Firestore y a los servicios de push. */
const CONCURRENCY = 5

/**
 * Tope de autos, y de mantenimientos entre todos sus autos, que se leen por usuario: nadie con datos de más alarga el
 * cron de todos. De las lecturas de km se lee una por auto, así que también quedan dentro del tope.
 */
const MAX_DOCS_PER_USER = 1000

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function carFrom(id: string, x: DocumentData): Car {
  return {
    id,
    brand: x.brand ?? '',
    model: x.model ?? '',
    version: x.version ?? null,
    year: num(x.year),
    plate: x.plate ?? null,
    fuelTypes: fuelTypesFromDoc(x.fuelTypes),
    currentKm: num(x.currentKm) ?? 0,
    kmUpdatedAt: toDate(x.kmUpdatedAt),
    avgKmPerDay: num(x.avgKmPerDay),
    photoUrl: x.photoUrl ?? null,
    photoPublicId: x.photoPublicId ?? null,
    createdAt: toDate(x.createdAt) ?? new Date(0),
  }
}

/**
 * Un mantenimiento como lo usa el cron: la proyección guardada (`lastDone*`, `completedByJobId`), sin leer trabajos.
 * La base, como en `ruleFrom` de lib/db.ts: si el documento no tiene los campos (versión anterior de la PWA), es la
 * "última vez" guardada.
 */
function ruleFrom(id: string, x: DocumentData): MaintenanceRule {
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

/**
 * La lectura de más km de un auto: la primera ordenando por km de mayor a menor, que usa el índice simple
 * automático. null si no tiene lecturas (las que no tienen km no entran en la consulta).
 */
async function topReadingOf(carDoc: QueryDocumentSnapshot) {
  const snap = await carDoc.ref.collection('odometer').orderBy('km', 'desc').limit(1).get()
  const x = snap.docs[0]?.data()
  const km = num(x?.km)
  return km == null ? null : { km, date: toDate(x?.date) }
}

/** Los mantenimientos de los autos, uno tras otro hasta llenar el tope de `MAX_DOCS_PER_USER`. */
async function rulesOf(carDocs: QueryDocumentSnapshot[]) {
  const rules: MaintenanceRule[] = []
  for (const carDoc of carDocs) {
    const remaining = MAX_DOCS_PER_USER - rules.length
    if (remaining <= 0) break
    const rulesSnap = await carDoc.ref.collection('rules').limit(remaining).get()
    rules.push(...rulesSnap.docs.map(d => ruleFrom(d.id, d.data())))
  }
  return rules
}

const sha256 = (s: string) => createHash('sha256').update(s).digest()

/** Compara el header con el secret en tiempo constante; los hashes igualan el largo para timingSafeEqual. */
function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return timingSafeEqual(sha256(header ?? ''), sha256(`Bearer ${secret}`))
}

/** Mezcla los usuarios en cada corrida: si no alcanza el tiempo, no quedan afuera siempre los mismos. */
function shuffled<T>(items: T[]) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type UserReport = { uid: string; messages: number; sent: number; error?: string }

/**
 * Manda los avisos del día a un usuario y guarda cuáles se avisaron. Los recordatorios cumplidos (`completedByJobId`)
 * no se avisan (`planDailyNotifications` los saltea). El km de cada auto es el de su lectura más alta
 * (`carKmForNotifications`), no el `currentKm` guardado, que sólo se corrige cuando alguien abre la app. Las lecturas
 * de todos los autos se piden a la vez, mientras se leen los mantenimientos. Las escrituras son independientes (no
 * un batch): si se borró un mantenimiento, los demás se guardan igual. El código 5 (NOT_FOUND) es un mantenimiento
 * que se borró mientras corría el cron: no hay nada que guardar.
 */
async function processUser(userDoc: QueryDocumentSnapshot, now: Date): Promise<UserReport> {
  const db = adminDb()
  const x = userDoc.data()
  const settings: UserSettings = {
    reminder: { ...DEFAULT_SETTINGS.reminder, ...(x.reminder ?? {}) },
    timezone: x.timezone ?? DEFAULT_SETTINGS.timezone,
  }
  const carsSnap = await db.collection('cars').where('ownerUid', '==', userDoc.id).limit(MAX_DOCS_PER_USER).get()
  const [rules, tops] = await Promise.all([rulesOf(carsSnap.docs), Promise.all(carsSnap.docs.map(topReadingOf))])
  const carIdByRule = new Map(rules.map(r => [r.id, r.carId]))
  const { messages, ruleUpdates } = planDailyNotifications({
    settings,
    cars: carsSnap.docs.map((d, i) => carKmForNotifications(carFrom(d.id, d.data()), tops[i])),
    rules,
    today: todayInTimeZone(settings.timezone, now),
    now,
  })

  const { sent, delivered } = await sendToUser(userDoc.id, messages)
  const updates = updatesToPersist(ruleUpdates, delivered)
  if (updates.length) {
    const writer = db.bulkWriter()
    writer.onWriteError(err => err.code !== 5 && err.failedAttempts < 3)
    for (const u of updates) {
      writer
        .update(db.collection('cars').doc(carIdByRule.get(u.ruleId)!).collection('rules').doc(u.ruleId), {
          lastNotifiedStatus: u.lastNotifiedStatus,
          lastNotifiedAt: u.notified ? Timestamp.fromDate(now) : null,
        })
        .catch(e => {
          if (e.code !== 5) console.error('Cron: no se guardó el aviso', userDoc.id, u.ruleId, e)
        })
    }
    await writer.close()
  }
  return { uid: userDoc.id, messages: messages.length, sent }
}

/**
 * Vercel Cron la llama una vez por día (ver vercel.json) con "Authorization: Bearer $CRON_SECRET".
 * Cada worker toma el próximo usuario hasta que no quedan o se acaba el tiempo; el error de un usuario no corta a
 * los demás.
 */
export async function GET(request: Request) {
  const startedAt = Date.now()
  if (!authorized(request.headers.get('authorization'))) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  const now = new Date()
  const users = shuffled((await adminDb().collection('users').get()).docs)
  const report: UserReport[] = []

  let next = 0
  const worker = async () => {
    while (next < users.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const userDoc = users[next++]
      try {
        report.push(await processUser(userDoc, now))
      } catch (e) {
        console.error('Cron: error con usuario', userDoc.id, e)
        report.push({ uid: userDoc.id, messages: 0, sent: 0, error: (e as Error).message })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const skipped = users.length - next
  if (skipped) console.warn(`Cron: se acabó el tiempo, quedaron ${skipped} de ${users.length} usuarios sin procesar`)
  return Response.json({ ok: true, users: report.length, skipped, report })
}
