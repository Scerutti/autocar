import 'server-only'
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type Firestore } from 'firebase-admin/firestore'
import { photoFailureAction, purgePhotoId } from './cars'
import { destroyImage } from './cloudinary-server'
import { adminDb } from './firebase/admin'

/**
 * Cómo quedó la foto al terminar de borrar un auto: `none` si no tenía (o era de otra carpeta, `purgePhotoId`),
 * `deleted` si se borró en Cloudinary (o ya no estaba), `pending` si Cloudinary falló y se reintenta (el auto marcado
 * queda sin historial para el barrido del cron), `abandoned` si Cloudinary volvió a fallar y se borró el auto igual
 * (`photoFailureAction`): la foto queda huérfana en Cloudinary.
 */
export type PurgePhoto = 'none' | 'deleted' | 'pending' | 'abandoned'

/** Operaciones por batch al borrar las invitaciones y los avisos: un batch admite hasta 500. */
const BATCH_SIZE = 450

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)

/** Borra en batches de `BATCH_SIZE` los documentos de una colección de primer nivel con ese `carId`. */
async function deleteByCarId(db: Firestore, collection: string, carId: string) {
  const snap = await db.collection(collection).where('carId', '==', carId).select().get()
  for (let i = 0; i < snap.docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    snap.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
}

/**
 * Termina de borrar un auto con el Admin SDK (no pasa por las reglas), a partir de su documento (`data`). Es
 * idempotente y se puede retomar: si se corta a mitad de camino, la próxima llamada (la ruta otra vez o el barrido del
 * cron) sigue desde lo que quedó.
 * 1. Las invitaciones (`invites where carId`) y los avisos de trabajos (`notices where carId`, de `/api/notify/job`).
 * 2. Todas sus subcolecciones con `recursiveDelete` (mantenimientos, trabajos, cargas, lecturas y cualquier otra).
 * 3. La foto en Cloudinary (`destroyImage`), sólo si es de la carpeta del dueño (`purgePhotoId`).
 * 4. El documento del auto. Si la foto falló, `photoFailureAction` con los fallos anteriores (`purgeAttempts`,
 *    `photoFailedAt`, que sólo escribe esta función): `retry` suma el intento (y la fecha del primer fallo) y deja el
 *    auto marcado para el barrido; `give-up` lo borra igual y deja el `publicId` en los logs.
 */
export async function purgeCar(carRef: DocumentReference, data: DocumentData, now = new Date()): Promise<{ photo: PurgePhoto }> {
  const db = adminDb()
  await deleteByCarId(db, 'invites', carRef.id)
  await deleteByCarId(db, 'notices', carRef.id)
  for (const col of await carRef.listCollections()) await db.recursiveDelete(col)

  const car = { ownerUid: str(data.ownerUid), photoPublicId: str(data.photoPublicId) }
  const publicId = purgePhotoId(car)
  if (car.photoPublicId && !publicId) {
    console.warn('Borrado de auto: la foto no es de la carpeta del dueño y queda en Cloudinary', carRef.id)
  }
  let photo: PurgePhoto = 'none'
  if (publicId) {
    const destroyed = await destroyImage(publicId)
    photo = destroyed.ok ? 'deleted' : 'pending'
  }
  if (photo === 'pending') {
    const previous = { purgeAttempts: num(data.purgeAttempts), photoFailedAt: toDate(data.photoFailedAt) }
    if (photoFailureAction(previous, now) === 'retry') {
      await carRef.update({
        purgeAttempts: FieldValue.increment(1),
        ...(previous.photoFailedAt ? {} : { photoFailedAt: Timestamp.fromDate(now) }),
      })
      return { photo }
    }
    console.error('Borrado de auto: no se pudo borrar la foto en Cloudinary y queda huérfana', carRef.id, publicId)
    photo = 'abandoned'
  }
  await carRef.delete()
  return { photo }
}
