import { Timestamp } from 'firebase-admin/firestore'
import { adminDb, authorize } from '@/lib/firebase/admin'
import { planJobNotification, type JobNotificationEvent } from '@/lib/notifications'
import { sendToUser, serverCarFrom, serverJobFrom } from '@/lib/push-server'

const EVENTS: readonly JobNotificationEvent[] = ['submitted', 'approved', 'rejected']

/**
 * Aviso push al momento cuando un miembro manda un trabajo (`submitted`, al dueño) o cuando el dueño lo aprueba o
 * rechaza (`approved` | `rejected`, al miembro autor). Es idempotente: antes de enviar hace `create()` de
 * `notices/{jobId}_{event}_{revision}`; si ya existe (reintento o doble click), responde 200 sin volver a enviar.
 */
export async function POST(request: Request) {
  const auth = await authorize(request)
  if (auth instanceof Response) return auth
  const { uid } = auth

  const body = (await request.json().catch(() => null)) as {
    carId?: unknown
    jobId?: unknown
    event?: unknown
  } | null
  const carId = typeof body?.carId === 'string' ? body.carId.trim() : ''
  const jobId = typeof body?.jobId === 'string' ? body.jobId.trim() : ''
  const event = EVENTS.find(e => e === body?.event)
  if (!carId || !jobId || !event) {
    return Response.json({ error: 'Pedido inválido' }, { status: 400 })
  }

  try {
    const db = adminDb()
    const carRef = db.collection('cars').doc(carId)
    const [carSnap, jobSnap] = await Promise.all([carRef.get(), carRef.collection('jobs').doc(jobId).get()])
    const carData = carSnap.data()
    const jobData = jobSnap.data()
    if (!carData || !jobData) {
      return Response.json({ error: 'No encontrado' }, { status: 404 })
    }

    const plan = planJobNotification({
      uid,
      car: serverCarFrom(carSnap.id, carData),
      job: serverJobFrom(jobSnap.id, jobData),
      event,
    })
    if (!plan.ok) {
      return Response.json({ error: 'No autorizado' }, { status: 403 })
    }

    try {
      await db
        .collection('notices')
        .doc(plan.noticeId)
        .create({ carId, jobId, event, createdAt: Timestamp.now() })
    } catch (e) {
      if ((e as { code?: number }).code === 6) {
        return Response.json({ sent: 0, duplicate: true })
      }
      throw e
    }

    const { sent } = await sendToUser(plan.recipientUid, [plan.message])
    return Response.json({ sent })
  } catch (e) {
    console.error('Aviso de trabajo', e)
    return Response.json({ error: 'No se pudo enviar el aviso' }, { status: 500 })
  }
}
