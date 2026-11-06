import 'server-only'
import type { DocumentReference } from 'firebase-admin/firestore'
import { purgePhotoId } from './cars'
import { destroyImage } from './cloudinary-server'
import { adminDb } from './firebase/admin'

/**
 * Cómo quedó la foto al terminar de borrar un auto: `none` si no tenía (o era de otra carpeta, `purgePhotoId`),
 * `deleted` si se borró en Cloudinary (o ya no estaba), `pending` si Cloudinary falló: el auto marcado queda sin
 * historial y el barrido del cron lo vuelve a intentar.
 */
export type PurgePhoto = 'none' | 'deleted' | 'pending'

/** Operaciones por batch al borrar las invitaciones: un batch admite hasta 500. */
const BATCH_SIZE = 450

/**
 * Termina de borrar un auto con el Admin SDK (no pasa por las reglas). Es idempotente y se puede retomar: si se corta a
 * mitad de camino, la próxima llamada (la ruta otra vez o el barrido del cron) sigue desde lo que quedó.
 * 1. Las invitaciones del auto (`invites where carId`), así a nadie le queda una pendiente de un auto que no existe.
 * 2. Todas sus subcolecciones con `recursiveDelete` (mantenimientos, trabajos, cargas, lecturas y cualquier otra).
 * 3. La foto en Cloudinary (`destroyImage`), sólo si es de la carpeta del dueño (`purgePhotoId`).
 * 4. El documento del auto, recién si la foto no quedó pendiente: así el auto marcado sigue apareciendo en el barrido
 *    hasta que Cloudinary responde, y la foto no queda huérfana.
 */
export async function purgeCar(
  carRef: DocumentReference,
  car: { ownerUid?: string | null; photoPublicId?: string | null },
): Promise<{ photo: PurgePhoto }> {
  const db = adminDb()
  const invites = await db.collection('invites').where('carId', '==', carRef.id).select().get()
  for (let i = 0; i < invites.docs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    invites.docs.slice(i, i + BATCH_SIZE).forEach(d => batch.delete(d.ref))
    await batch.commit()
  }
  for (const col of await carRef.listCollections()) await db.recursiveDelete(col)

  const publicId = purgePhotoId(car)
  if (car.photoPublicId && !publicId) {
    console.warn('Borrado de auto: la foto no es de la carpeta del dueño y queda en Cloudinary', carRef.id)
  }
  let photo: PurgePhoto = 'none'
  if (publicId) {
    const destroyed = await destroyImage(publicId)
    photo = destroyed.ok ? 'deleted' : 'pending'
  }
  if (photo === 'pending') return { photo }
  await carRef.delete()
  return { photo }
}
