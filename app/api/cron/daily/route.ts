import { createHash, timingSafeEqual } from 'node:crypto'
import { Timestamp, type DocumentData, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { todayInTimeZone } from '@/lib/dates'
import { planDailyNotifications, updatesToPersist } from '@/lib/notifications'
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

/** Tope de autos y de mantenimientos que se leen por usuario: nadie con datos de más alarga el cron de todos. */
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

function ruleFrom(id: string, x: DocumentData): MaintenanceRule {
  return {
    id,
    carId: x.carId,
    name: x.name ?? '',
    intervalKm: num(x.intervalKm),
    intervalTime: intervalFromDoc(x),
    repeat: x.repeat !== false,
    lastDoneKm: num(x.lastDoneKm),
    lastDoneDate: x.lastDoneDate ?? null,
    warnKm: num(x.warnKm) ?? 500,
    warnDays: num(x.warnDays) ?? 30,
    lastNotifiedAt: toDate(x.lastNotifiedAt),
    lastNotifiedStatus: x.lastNotifiedStatus ?? null,
  }
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

async function processUser(userDoc: QueryDocumentSnapshot, now: Date): Promise<UserReport> {
  const db = adminDb()
  const x = userDoc.data()
  const settings: UserSettings = {
    reminder: { ...DEFAULT_SETTINGS.reminder, ...(x.reminder ?? {}) },
    timezone: x.timezone ?? DEFAULT_SETTINGS.timezone,
  }
  const [carsSnap, rulesSnap] = await Promise.all([
    userDoc.ref.collection('cars').limit(MAX_DOCS_PER_USER).get(),
    userDoc.ref.collection('rules').limit(MAX_DOCS_PER_USER).get(),
  ])
  const { messages, ruleUpdates } = planDailyNotifications({
    settings,
    cars: carsSnap.docs.map(d => carFrom(d.id, d.data())),
    rules: rulesSnap.docs.map(d => ruleFrom(d.id, d.data())),
    today: todayInTimeZone(settings.timezone, now),
    now,
  })

  const { sent, delivered } = await sendToUser(userDoc.id, messages)
  const updates = updatesToPersist(ruleUpdates, delivered)
  if (updates.length) {
    const batch = db.batch()
    for (const u of updates) {
      batch.update(userDoc.ref.collection('rules').doc(u.ruleId), {
        lastNotifiedStatus: u.lastNotifiedStatus,
        lastNotifiedAt: u.notified ? Timestamp.fromDate(now) : null,
      })
    }
    await batch.commit()
  }
  return { uid: userDoc.id, messages: messages.length, sent }
}

// Vercel Cron la llama una vez por día (ver vercel.json) con "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const startedAt = Date.now()
  if (!authorized(request.headers.get('authorization'))) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  const now = new Date()
  const users = shuffled((await adminDb().collection('users').get()).docs)
  const report: UserReport[] = []

  // Cada worker toma el próximo usuario hasta que no quedan o se acaba el tiempo.
  let next = 0
  const worker = async () => {
    while (next < users.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const userDoc = users[next++]
      try {
        report.push(await processUser(userDoc, now))
      } catch (e) {
        // El error de un usuario no corta a los demás.
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
