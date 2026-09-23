import { Timestamp, type DocumentData } from 'firebase-admin/firestore'
import { adminDb } from '@/lib/firebase/admin'
import { todayInTimeZone } from '@/lib/dates'
import { planDailyNotifications } from '@/lib/notifications'
import { fuelTypesFromDoc, intervalFromDoc } from '@/lib/parse'
import { sendToUser } from '@/lib/push-server'
import { DEFAULT_SETTINGS, type Car, type MaintenanceRule, type UserSettings } from '@/lib/types'

export const maxDuration = 60

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

// Vercel Cron la llama una vez por día (ver vercel.json) con "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  const db = adminDb()
  const now = new Date()
  const users = await db.collection('users').get()
  const report: { uid: string; messages: number; sent: number; error?: string }[] = []

  for (const userDoc of users.docs) {
    try {
      const x = userDoc.data()
      const settings: UserSettings = {
        reminder: { ...DEFAULT_SETTINGS.reminder, ...(x.reminder ?? {}) },
        timezone: x.timezone ?? DEFAULT_SETTINGS.timezone,
      }
      const [carsSnap, rulesSnap] = await Promise.all([
        userDoc.ref.collection('cars').get(),
        userDoc.ref.collection('rules').get(),
      ])
      const { messages, ruleUpdates } = planDailyNotifications({
        settings,
        cars: carsSnap.docs.map(d => carFrom(d.id, d.data())),
        rules: rulesSnap.docs.map(d => ruleFrom(d.id, d.data())),
        today: todayInTimeZone(settings.timezone, now),
        now,
      })

      const { sent } = await sendToUser(userDoc.id, messages)

      // Si no le llegó a ningún dispositivo (no tiene, o fallaron todos) no lo marcamos como avisado:
      // se reintenta al día siguiente en vez de esperar 7 días.
      const updates = sent > 0 ? ruleUpdates : ruleUpdates.filter(u => !u.notified)
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
      report.push({ uid: userDoc.id, messages: messages.length, sent })
    } catch (e) {
      console.error('Cron: error con usuario', userDoc.id, e)
      report.push({ uid: userDoc.id, messages: 0, sent: 0, error: (e as Error).message })
    }
  }

  return Response.json({ ok: true, users: report.length, report })
}
