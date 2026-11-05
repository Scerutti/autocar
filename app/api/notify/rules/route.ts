import { Timestamp } from 'firebase-admin/firestore'
import { todayInTimeZone } from '@/lib/dates'
import { adminDb, authorize } from '@/lib/firebase/admin'
import { didRuleEscalate, effectiveRuleNotice, planRuleAlerts, type PushPayload } from '@/lib/notifications'
import { carKmForNotifications } from '@/lib/odometer'
import {
  MAX_DOCS_PER_USER,
  sendToUser,
  serverCarFrom,
  serverNoticeFrom,
  serverRuleFrom,
  serverSettingsFrom,
  topReadingOf,
} from '@/lib/push-server'
import type { Car, MaintenanceRule } from '@/lib/types'

/**
 * Reclama en una transacción el aviso de un mantenimiento que subió de estado para un destinatario: lee su
 * `users/{recipientUid}/ruleNotices/{ruleId}` y, si todavía no estaba en ese estado, graba el nuevo. Si otra llamada
 * concurrente ya lo grabó, devuelve `false` y no se duplica el push.
 */
async function claimRuleNotice(
  recipientUid: string,
  owner: boolean,
  rule: MaintenanceRule,
  nextStatus: 'soon' | 'overdue',
  now: Date,
) {
  const db = adminDb()
  const ref = db.collection('users').doc(recipientUid).collection('ruleNotices').doc(rule.id)
  return db.runTransaction(async tx => {
    const snap = await tx.get(ref)
    const prev = effectiveRuleNotice(rule, owner, snap.exists ? serverNoticeFrom(snap.data()!) : undefined)
    if (!didRuleEscalate(prev.status, nextStatus)) return false
    tx.set(ref, { status: nextStatus, at: Timestamp.fromDate(now) })
    return true
  })
}

/**
 * Envía a un destinatario del auto los mantenimientos que subieron de estado con la carga recién guardada. Si es un
 * miembro y desactivó `"Avisos de autos compartidos"` (`sharedCars === false`), no se le manda nada.
 */
async function notifyRecipient(
  recipientUid: string,
  car: Car,
  rules: MaintenanceRule[],
  now: Date,
) {
  const db = adminDb()
  const owner = car.ownerUid === recipientUid
  const userSnap = await db.collection('users').doc(recipientUid).get()
  const settings = serverSettingsFrom(userSnap.data())
  if (!owner && !settings.sharedCars) return 0

  const today = todayInTimeZone(settings.timezone, now)
  const candidates = planRuleAlerts({ car, rules, owner, today })
  if (!candidates.length) return 0

  const messages: PushPayload[] = []
  for (const alert of candidates) {
    const claimed = await claimRuleNotice(recipientUid, owner, alert.rule, alert.status, now)
    if (claimed) messages.push(alert.message)
  }
  if (!messages.length) return 0

  const { sent } = await sendToUser(recipientUid, messages)
  return sent
}

/**
 * Aviso push al momento cuando una carga de km, de combustible o un trabajo (o sus "Deshacer") deja un mantenimiento
 * activo por vencer o vencido: avisa al resto del grupo del auto (dueño y miembros en `memberUids`, salvo quien llamó)
 * con el mismo texto y tag que el cron diario y graba su `users/{uid}/ruleNotices/{ruleId}` en una transacción por
 * persona y mantenimiento, así una segunda llamada o el cron de la mañana no lo repiten.
 */
export async function POST(request: Request) {
  const auth = await authorize(request)
  if (auth instanceof Response) return auth
  const { uid } = auth

  const body = (await request.json().catch(() => null)) as { carId?: unknown } | null
  const carId = typeof body?.carId === 'string' ? body.carId.trim() : ''
  if (!carId) {
    return Response.json({ error: 'Pedido inválido' }, { status: 400 })
  }

  try {
    const db = adminDb()
    const carRef = db.collection('cars').doc(carId)
    const carSnap = await carRef.get()
    const carData = carSnap.data()
    if (!carData) {
      return Response.json({ error: 'No encontrado' }, { status: 404 })
    }

    const rawCar = serverCarFrom(carSnap.id, carData)
    const isOwner = rawCar.ownerUid === uid
    const isMember = (rawCar.memberUids ?? []).includes(uid)
    if (!isOwner && !isMember) {
      return Response.json({ error: 'No autorizado' }, { status: 403 })
    }

    const recipients = [rawCar.ownerUid, ...(rawCar.memberUids ?? [])].filter(
      (u): u is string => Boolean(u) && u !== uid,
    )
    if (!recipients.length) {
      return Response.json({ sent: 0 })
    }

    const [rulesSnap, top] = await Promise.all([
      carRef.collection('rules').limit(MAX_DOCS_PER_USER).get(),
      topReadingOf(carSnap),
    ])
    const car = carKmForNotifications(rawCar, top)
    const rules = rulesSnap.docs.map(d => serverRuleFrom(d.id, d.data()))
    const now = new Date()

    const counts = await Promise.all(recipients.map(r => notifyRecipient(r, car, rules, now)))
    return Response.json({ sent: counts.reduce((a, b) => a + b, 0) })
  } catch (e) {
    console.error('Aviso de mantenimientos', e)
    return Response.json({ error: 'No se pudo enviar el aviso' }, { status: 500 })
  }
}
