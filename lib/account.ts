import { exportCarLabel } from './export'
import type { Car } from './types'

/** Lo que hay que escribir para confirmar el borrado de la cuenta. */
export const DELETE_ACCOUNT_WORD = 'BORRAR'

/** Si lo que escribió la persona confirma el borrado: "BORRAR", sin importar mayúsculas ni espacios en los bordes. */
export const isDeleteConfirmed = (text: string) => text.trim().toUpperCase() === DELETE_ACCOUNT_WORD

/** Un auto que no deja borrar la cuenta: el id y cómo se muestra ("Ford Ka 2015 (AB123CD)"). */
export interface BlockingCar {
  id: string
  label: string
}

/**
 * Los autos propios que no dejan borrar la cuenta (`DELETE /api/account` responde 409 y no borra nada): los que tienen
 * miembros (`memberUids`). Borrarlos se llevaría el historial que cargaron otras personas, así que primero hay que
 * pasárselos a un miembro, sacar a los miembros o borrar el auto. Un auto ya marcado como borrado (`deletedAt`) no
 * cuenta: lo termina de borrar el servidor de todos modos.
 */
export function carsBlockingAccountDeletion(
  cars: Pick<Car, 'id' | 'brand' | 'model' | 'version' | 'year' | 'plate' | 'ownerUid' | 'memberUids' | 'deletedAt'>[],
  uid: string,
): BlockingCar[] {
  return cars
    .filter(c => c.ownerUid === uid && !c.deletedAt && (c.memberUids ?? []).length > 0)
    .map(c => ({ id: c.id, label: exportCarLabel(c) || 'Auto sin nombre' }))
}

/** Las subcolecciones de un auto donde un miembro carga registros a su nombre (`createdBy`, `createdByName`). */
export const AUTHORED_COLLECTIONS = ['jobs', 'fuel', 'odometer'] as const

/**
 * El auto de un registro, por la ruta del documento (`cars/{carId}/{jobs|fuel|odometer}/{id}`), si es de un auto de
 * otra persona: null si la ruta no es la de un registro de un auto (por ejemplo, las colecciones viejas
 * `users/{uid}/jobs`, que trae la misma consulta de grupo) o si el auto es propio (`ownedCarIds`: se borra entero).
 */
export function otherCarOfRecord(path: string, ownedCarIds: ReadonlySet<string>): string | null {
  const parts = path.split('/')
  if (parts.length !== 4 || parts[0] !== 'cars') return null
  if (!(AUTHORED_COLLECTIONS as readonly string[]).includes(parts[2])) return null
  return ownedCarIds.has(parts[1]) ? null : parts[1]
}

/** Carpeta de Cloudinary con todas las fotos de una cuenta, con la barra final: así no toca la de otro uid que empiece igual. */
export const accountImagePrefix = (uid: string) => `autocar/${uid}/`

/**
 * Cómo terminó `DELETE /api/account`, para la pantalla: `deleted` (cerrar sesión), `blocked` con los autos que hay
 * que resolver antes (409) o `error` con el mensaje para mostrar.
 */
export type AccountDeleteOutcome = { kind: 'deleted' } | { kind: 'blocked'; cars: BlockingCar[] } | { kind: 'error'; message: string }

/** Lee la respuesta de `DELETE /api/account` (`json` = el cuerpo, o `{}` si no era JSON). */
export function accountDeleteOutcome(status: number, json: unknown): AccountDeleteOutcome {
  const body = (json && typeof json === 'object' ? json : {}) as { deleted?: unknown; error?: unknown; cars?: unknown }
  if (status >= 200 && status < 300 && body.deleted === true) return { kind: 'deleted' }
  if (status === 409 && Array.isArray(body.cars)) {
    const cars = body.cars
      .filter((c): c is BlockingCar => Boolean(c) && typeof c.id === 'string' && typeof c.label === 'string')
      .map(c => ({ id: c.id, label: c.label }))
    return { kind: 'blocked', cars }
  }
  const message = typeof body.error === 'string' && body.error ? body.error : `El servidor tuvo un problema (error ${status}). Probá de nuevo en un rato.`
  return { kind: 'error', message }
}
