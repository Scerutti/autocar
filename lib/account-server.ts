import 'server-only'
import { FieldValue, type DocumentReference, type Firestore, type WriteBatch } from 'firebase-admin/firestore'
import {
  accountImagePrefix,
  accountPhotoRange,
  AUTHORED_COLLECTIONS,
  carsBlockingAccountDeletion,
  imagesToDelete,
  otherCarOfRecord,
  photosToKeep,
  type BlockingCar,
} from './account'
import { purgeCar } from './cars-server'
import { deleteImagesByIds, listImagesByPrefix } from './cloudinary-server'
import { accountRef, adminAuth, adminDb } from './firebase/admin'
import { serverCarFrom } from './push-server'
import { canonicalEmail } from './sharing'

/**
 * Cómo terminó `deleteAccount`: `deleted` (no queda nada, ni la cuenta de Firebase Auth); `blocked` con los autos
 * propios que tienen miembros (no se borró nada); `photos-pending` si Cloudinary falló (no se borró la cuenta ni el
 * registro en `allowlist`: hay que volver a llamar); `unavailable` si faltan los índices de `firestore.indexes.json`
 * (sin publicar o todavía no `READY`: no se borró nada).
 */
export type AccountDeletion =
  | { status: 'deleted' }
  | { status: 'blocked'; cars: BlockingCar[] }
  | { status: 'photos-pending' }
  | { status: 'unavailable' }

/**
 * Un fallo después de sacar la cuenta de `allowlist`: la app ya no puede usarla, así que la pantalla no tiene que
 * volver a registrarla (`/api/access`) sino reintentar el borrado o cerrar la sesión. `DELETE /api/account` responde
 * 500 con `closed: true`.
 */
export class AccountClosedError extends Error {
  constructor(readonly reason: unknown) {
    super('La cuenta ya no está en allowlist y no se terminó de borrar')
    this.name = 'AccountClosedError'
  }
}

/** Si un error es un `AccountClosedError` (por el nombre, así no depende de cómo se compila `instanceof`). */
export const isAccountClosedError = (e: unknown): e is AccountClosedError => (e as { name?: unknown } | null)?.name === 'AccountClosedError'

/** Operaciones por batch: un batch admite hasta 500. */
const BATCH_SIZE = 450

/** Aplica `write` a cada documento, en batches de `BATCH_SIZE`. */
async function writeInBatches(db: Firestore, refs: DocumentReference[], write: (batch: WriteBatch, ref: DocumentReference) => void) {
  for (let i = 0; i < refs.length; i += BATCH_SIZE) {
    const batch = db.batch()
    refs.slice(i, i + BATCH_SIZE).forEach(ref => write(batch, ref))
    await batch.commit()
  }
}

/** Error de Firestore `NOT_FOUND` (código 5): otro pedido o el barrido del cron ya lo borró. */
const isNotFound = (e: unknown) => (e as { code?: number }).code === 5

/** Error de Firebase Auth cuando la cuenta ya no existe. */
const isUserNotFound = (e: unknown) => (e as { code?: string }).code === 'auth/user-not-found'

/** El patrón de las consultas de grupo de `anonymizeRecords`, que necesitan los índices de `firestore.indexes.json`. */
const authoredQuery = (db: Firestore, collection: (typeof AUTHORED_COLLECTIONS)[number], uid: string) =>
  db.collectionGroup(collection).where('createdBy', '==', uid)

/**
 * Prueba las consultas de grupo (`limit(1)`) antes de borrar nada: si los índices no están publicados (o todavía no
 * están `READY`), Firestore tira `FAILED_PRECONDITION` (código 9) y devuelve false, con la cuenta intacta en vez de a
 * medio borrar. Cualquier otro error se tira.
 */
async function probeIndexes(db: Firestore, uid: string): Promise<boolean> {
  try {
    await Promise.all(AUTHORED_COLLECTIONS.map(c => authoredQuery(db, c, uid).select().limit(1).get()))
    return true
  } catch (e) {
    if ((e as { code?: unknown }).code !== 9) throw e
    console.error('Borrado de cuenta: faltan los índices de grupo de firestore.indexes.json (publicarlos y esperar READY)', e)
    return false
  }
}

/**
 * Marca como borrados todos los autos propios en una sola transacción, que relee `cars where ownerUid == uid`: si
 * alguno vivo tiene miembros (también uno que entró después del primer chequeo, porque aceptar una invitación cambia el
 * auto y hace repetir la transacción), devuelve los autos que bloquean y no escribe nada. Si no, pone `deletedAt` en los
 * que no lo tienen y revoca sus invitaciones pendientes (como `markCarDeleted`): desde ahí nadie acepta ni carga nada.
 * Una sola transacción y no una por auto: así un 409 nunca deja autos marcados (tope de 500 escrituras, de sobra para
 * los autos de una persona).
 */
async function markOwnedCars(db: Firestore, uid: string): Promise<BlockingCar[]> {
  return db.runTransaction(async tx => {
    const snap = await tx.get(db.collection('cars').where('ownerUid', '==', uid))
    const cars = snap.docs.map(d => serverCarFrom(d.id, d.data()))
    const blocking = carsBlockingAccountDeletion(cars, uid)
    if (blocking.length) return blocking
    const live = snap.docs.filter((_, i) => !cars[i].deletedAt)
    const invites = await Promise.all(
      live.map(d => tx.get(db.collection('invites').where('carId', '==', d.id).where('status', '==', 'pending'))),
    )
    live.forEach(d => tx.update(d.ref, { deletedAt: FieldValue.serverTimestamp() }))
    invites.flatMap(s => s.docs).forEach(i => tx.update(i.ref, { status: 'revoked' }))
    return []
  })
}

/**
 * Borra los autos propios (ya marcados) con todo su historial, sus invitaciones y su foto (`purgeCar`). Devuelve los que
 * quedaron con la foto `pending` (Cloudinary falló: quedan marcados y sin historial).
 */
async function purgeOwnedCars(db: Firestore, uid: string) {
  const snap = await db.collection('cars').where('ownerUid', '==', uid).get()
  const pending: DocumentReference[] = []
  for (const car of snap.docs) {
    try {
      const { photo } = await purgeCar(car.ref, car.data())
      if (photo === 'pending') pending.push(car.ref)
    } catch (e) {
      if (!isNotFound(e)) throw e
    }
  }
  return { ownedIds: new Set(snap.docs.map(d => d.id)), pending }
}

/**
 * Los registros que cargó en autos de otras personas (trabajos, cargas y lecturas de km con `createdBy == uid`, también
 * en los autos de los que ya salió) quedan en el historial del dueño, sin su nombre: `createdByName: null` (la app
 * muestra "otra persona", `authorLabel`). Los datos no cambian, así no cambian los gastos ni los mantenimientos. Sólo
 * escribe los que todavía tienen el nombre.
 */
async function anonymizeRecords(db: Firestore, uid: string, ownedCarIds: ReadonlySet<string>) {
  for (const collection of AUTHORED_COLLECTIONS) {
    const snap = await authoredQuery(db, collection, uid).select('createdByName').get()
    const refs = snap.docs.filter(d => d.get('createdByName') != null && otherCarOfRecord(d.ref.path, ownedCarIds)).map(d => d.ref)
    await writeInBatches(db, refs, (batch, ref) => batch.update(ref, { createdByName: null }))
  }
}

/** Lo saca de los autos donde es miembro: su uid de `memberUids` y su perfil (mail, nombre y rol) de `memberProfiles`. */
async function leaveSharedCars(db: Firestore, uid: string) {
  const snap = await db.collection('cars').where('memberUids', 'array-contains', uid).select().get()
  await writeInBatches(
    db,
    snap.docs.map(d => d.ref),
    (batch, ref) => batch.update(ref, { memberUids: FieldValue.arrayRemove(uid), [`memberProfiles.${uid}`]: FieldValue.delete() }),
  )
}

/** Las invitaciones que mandó (`ownerUid`) y las que le mandaron a su mail (`emailKey == canonicalEmail(email)`). */
async function deleteInvites(db: Firestore, uid: string, email: string) {
  const invites = db.collection('invites')
  const [sent, received] = await Promise.all([
    invites.where('ownerUid', '==', uid).select().get(),
    invites.where('emailKey', '==', canonicalEmail(email)).select().get(),
  ])
  const refs = new Map([...sent.docs, ...received.docs].map(d => [d.ref.path, d.ref]))
  await writeInBatches(db, [...refs.values()], (batch, ref) => batch.delete(ref))
}

/**
 * Las fotos de la carpeta de la cuenta (`autocar/{uid}/`), salvo las que usa un auto que ya es de otra persona
 * (`photosToKeep`: un auto que pasó con `transferCar` conserva su foto, que queda en Cloudinary). Busca esos autos por
 * rango de `photoPublicId` (`accountPhotoRange`), lista la carpeta (`listImagesByPrefix`) y borra por lista
 * (`deleteImagesByIds`, `imagesToDelete`). false si Cloudinary falló.
 */
async function deleteAccountImages(db: Firestore, uid: string) {
  const range = accountPhotoRange(uid)
  const using = await db
    .collection('cars')
    .where('photoPublicId', '>=', range.start)
    .where('photoPublicId', '<', range.end)
    .select('ownerUid', 'photoPublicId')
    .get()
  const keep = photosToKeep(
    using.docs.map(d => ({ ownerUid: d.get('ownerUid'), photoPublicId: d.get('photoPublicId') })),
    uid,
  )
  const listed = await listImagesByPrefix(accountImagePrefix(uid))
  if (!listed.ok) {
    console.error('Borrado de cuenta: no se pudo listar la carpeta en Cloudinary', uid, listed.error)
    return false
  }
  const deleted = await deleteImagesByIds(imagesToDelete(listed.value, keep, uid))
  if (!deleted.ok) {
    console.error('Borrado de cuenta: no se pudieron borrar las fotos', uid, deleted.error)
    return false
  }
  return true
}

/**
 * Borra la cuenta con el Admin SDK. Cada paso tolera que ya esté hecho: si se corta a mitad de camino (por ejemplo por
 * `maxDuration`), se puede volver a llamar.
 * 0. Si la cuenta de Firebase Auth ya no existe, devuelve `deleted` sin hacer nada (no gasta lecturas ni el cupo de la
 *    Admin API de Cloudinary con llamadas repetidas).
 * 1. Prueba las consultas de grupo (`probeIndexes`): sin los índices falla antes de tocar nada.
 * 2. Marca sus autos en una transacción (`markOwnedCars`): si alguno vivo tiene miembros, devuelve `blocked` sin
 *    escribir nada.
 * 3. Borra sus autos (`purgeOwnedCars`; un auto que ya no existe no se lee).
 * 4. Sus registros en autos de otras personas, sin su nombre (`anonymizeRecords`; sólo los que lo tienen).
 * 5. Sale de los autos compartidos (`leaveSharedCars`; `arrayRemove` y `delete` de un campo que no está no fallan).
 * 6. Sus invitaciones, mandadas y recibidas (`deleteInvites`; las borradas no aparecen en la consulta).
 * 7. `usage/{uid}` (borrar un documento que no existe no falla).
 * 8. Sus fotos en Cloudinary (`deleteAccountImages`; sin fotos = ok). Si falla, devuelve `photos-pending` sin seguir.
 *    Si anduvo, vuelve a purgar los autos cuya foto había quedado `pending` en el paso 3 (la foto ya no está: `purgeCar`
 *    recibe "not found" y borra el auto); si alguno vuelve a fallar, lo termina el barrido del cron.
 * 9. `revokeRefreshTokens`: ningún dispositivo consigue un token nuevo, y `/api/access` (que verifica la revocación)
 *    rechaza los de antes, así no vuelve a registrar la cuenta.
 * 10. `allowlist/{mail}`: desde acá las reglas de Firestore rechazan todo lo que mande la app con esta cuenta (un
 *    dispositivo abierto no vuelve a crear `users/{uid}`). Un fallo desde acá tira `AccountClosedError`.
 * 11. `users/{uid}` con sus subcolecciones (`recursiveDelete`: ajustes, suscripciones push, logros, `ruleNotices` y las
 *    colecciones viejas de antes de la migración).
 * 12. La cuenta de Firebase Auth (`deleteUser`; `auth/user-not-found` = ya borrada). Va última: mientras exista, el
 *    mismo token sirve para reintentar.
 */
export async function deleteAccount(uid: string, email: string): Promise<AccountDeletion> {
  try {
    await adminAuth().getUser(uid)
  } catch (e) {
    if (isUserNotFound(e)) return { status: 'deleted' }
    throw e
  }
  const db = adminDb()
  if (!(await probeIndexes(db, uid))) return { status: 'unavailable' }
  const blocking = await markOwnedCars(db, uid)
  if (blocking.length) return { status: 'blocked', cars: blocking }

  const { ownedIds, pending } = await purgeOwnedCars(db, uid)
  await anonymizeRecords(db, uid, ownedIds)
  await leaveSharedCars(db, uid)
  await deleteInvites(db, uid, email)
  await db.collection('usage').doc(uid).delete()
  if (!(await deleteAccountImages(db, uid))) return { status: 'photos-pending' }
  for (const ref of pending) {
    const snap = await ref.get()
    const data = snap.data()
    if (data) await purgeCar(ref, data).catch(e => console.error('Borrado de cuenta: auto con la foto pendiente', ref.id, e))
  }

  await adminAuth().revokeRefreshTokens(uid)
  await accountRef(email).delete()
  try {
    await db.recursiveDelete(db.collection('users').doc(uid))
    try {
      await adminAuth().deleteUser(uid)
    } catch (e) {
      if (!isUserNotFound(e)) throw e
    }
  } catch (e) {
    throw new AccountClosedError(e)
  }
  return { status: 'deleted' }
}
