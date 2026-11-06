import { FieldValue } from 'firebase-admin/firestore'
import { carDeleteDecision, isCarId } from '@/lib/cars'
import { purgeCar } from '@/lib/cars-server'
import { adminDb, authorize } from '@/lib/firebase/admin'
import { serverCarFrom } from '@/lib/push-server'

export const maxDuration = 60

/**
 * Borra un auto del dueño con todo su historial y su foto (`purgeCar`). La app primero lo marca (`markCarDeleted`) y
 * después llama a esta ruta; si el auto no tiene la marca, la pone antes de borrar, así nadie carga nada mientras
 * tanto. Es idempotente: un auto que ya no existe responde 200 `{ deleted: true }`. Si Cloudinary falla, responde 200
 * con `photo: 'pending'`: el historial ya se borró, y el auto marcado queda para que el barrido del cron
 * (`/api/cron/daily`) borre la foto y el documento. Sólo el dueño: si no, 403.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ carId: string }> }) {
  const auth = await authorize(request)
  if (auth instanceof Response) return auth
  const { uid } = auth
  const { carId } = await params
  if (!isCarId(carId)) return Response.json({ error: 'Auto inválido' }, { status: 400 })

  try {
    const carRef = adminDb().collection('cars').doc(carId)
    const snap = await carRef.get()
    const data = snap.data()
    const car = data ? serverCarFrom(snap.id, data) : null
    const decision = carDeleteDecision(car, uid)
    if (decision === 'gone' || !car) return Response.json({ deleted: true })
    if (decision === 'forbidden') return Response.json({ error: 'Sólo el dueño puede borrar el auto' }, { status: 403 })
    if (decision === 'mark') await carRef.update({ deletedAt: FieldValue.serverTimestamp() })
    const { photo } = await purgeCar(carRef, car)
    return Response.json({ deleted: true, photo })
  } catch (e) {
    if ((e as { code?: number }).code === 5) return Response.json({ deleted: true })
    console.error('Borrado de auto', carId, e)
    return Response.json({ error: 'No se pudo borrar el auto' }, { status: 500 })
  }
}
