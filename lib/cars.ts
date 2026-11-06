import { isOwnPublicId } from './photo-limits'

/**
 * Cuánto tiempo después de marcado (`deletedAt`) el barrido del cron termina de borrar un auto. Antes de eso lo borra
 * `DELETE /api/cars/[carId]`, que la app llama apenas el servidor confirma la marca; el barrido cubre la app cerrada a
 * mitad de camino y la marca que se sincronizó sin la app abierta.
 */
export const PURGE_DELAY_MS = 60 * 60 * 1000

/**
 * Qué hace `DELETE /api/cars/[carId]` con el auto como está en Firestore (null si no existe): `gone` si ya no existe
 * (otro pedido o el barrido lo terminó: responde 200, así la ruta es idempotente); `forbidden` si quien pide no es el
 * dueño; `mark` si es el dueño y falta la marca (la pone antes de borrar, así nadie carga nada mientras tanto);
 * `purge` si ya estaba marcado.
 */
export type CarDeleteDecision = 'gone' | 'forbidden' | 'mark' | 'purge'

export function carDeleteDecision(
  car: { ownerUid?: string | null; deletedAt?: Date | null } | null,
  uid: string,
): CarDeleteDecision {
  if (!car) return 'gone'
  if (!car.ownerUid || car.ownerUid !== uid) return 'forbidden'
  return car.deletedAt ? 'purge' : 'mark'
}

/** Hasta qué instante tiene que estar marcado un auto para que el barrido lo borre: `now` menos `PURGE_DELAY_MS`. */
export function purgeCutoff(now: Date) {
  return new Date(now.getTime() - PURGE_DELAY_MS)
}

/** Intentos de borrar la foto en Cloudinary después de los cuales se borra el auto igual y la foto queda huérfana. */
export const MAX_PURGE_ATTEMPTS = 3

/** Días desde el primer fallo de la foto (`photoFailedAt`) después de los cuales se borra el auto igual. */
export const PHOTO_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Qué hace `purgeCar` cuando Cloudinary no pudo borrar la foto de un auto marcado, según los fallos anteriores que
 * guardó en el auto (`purgeAttempts`, `photoFailedAt`; faltan antes del primero): `retry` guarda este fallo y deja el
 * auto para el barrido; `give-up` borra el auto igual (la foto queda huérfana en Cloudinary) cuando este fallo llega a
 * `MAX_PURGE_ATTEMPTS` o el primero fue hace `PHOTO_GIVE_UP_MS` o más. Así un auto cuya foto no se puede borrar no
 * queda primero en el barrido para siempre.
 */
export function photoFailureAction(
  previous: { purgeAttempts?: number | null; photoFailedAt?: Date | null },
  now: Date,
): 'retry' | 'give-up' {
  const attempts = (previous.purgeAttempts ?? 0) + 1
  if (attempts >= MAX_PURGE_ATTEMPTS) return 'give-up'
  if (previous.photoFailedAt && now.getTime() - previous.photoFailedAt.getTime() >= PHOTO_GIVE_UP_MS) return 'give-up'
  return 'retry'
}

/**
 * Id de un auto que acepta la ruta: el que genera Firestore (20 letras y números) o cualquier otro sin `/` ni
 * caracteres raros, hasta 100. Así `doc(carId)` no falla con `.`, `..` o una ruta.
 */
export function isCarId(carId: unknown): carId is string {
  return typeof carId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(carId)
}

/**
 * La foto que se borra en Cloudinary junto con el auto: sólo si está en la carpeta del dueño actual
 * (`autocar/{ownerUid}`), como pide `/api/cloudinary/delete`. Así un `photoPublicId` que apunta a la foto de otra
 * cuenta no la borra. null si no tiene foto o es de otra carpeta (por ejemplo, la subió el dueño anterior antes de
 * pasarle el auto): esa queda en Cloudinary.
 */
export function purgePhotoId(car: { ownerUid?: string | null; photoPublicId?: string | null }) {
  if (!car.ownerUid || !car.photoPublicId) return null
  return isOwnPublicId(car.photoPublicId, `autocar/${car.ownerUid}`) ? car.photoPublicId : null
}
