import 'server-only'
import { FieldValue, type DocumentReference, type Firestore, type QueryDocumentSnapshot, type WriteBatch } from 'firebase-admin/firestore'
import { accountImagePrefix, AUTHORED_COLLECTIONS, carsBlockingAccountDeletion, otherCarOfRecord, type BlockingCar } from './account'
import { carDeleteDecision } from './cars'
import { purgeCar } from './cars-server'
import { deleteImagesByPrefix } from './cloudinary-server'
import { accountRef, adminAuth, adminDb } from './firebase/admin'
import { serverCarFrom } from './push-server'
import { canonicalEmail } from './sharing'

/**
 * Cómo terminó `deleteAccount`: `deleted` (no queda nada, ni la cuenta de Firebase Auth); `blocked` con los autos
 * propios que tienen miembros (no se borró nada); `photos-pending` si Cloudinary falló (no se borró la cuenta ni el
 * registro en `allowlist`: hay que volver a llamar).
 */
export type AccountDeletion = { status: 'deleted' } | { status: 'blocked'; cars: BlockingCar[] } | { status: 'photos-pending' }

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

/**
 * Los autos propios: los marca (`deletedAt`, si no lo estaban, como `DELETE /api/cars/[carId]`) y los borra con todo su
 * historial, sus invitaciones y su foto (`purgeCar`). Devuelve false si la foto de alguno quedó `pending` (Cloudinary
 * falló: el auto queda marcado y sin historial, y la próxima llamada o el barrido del cron lo terminan).
 */
async function purgeOwnedCars(uid: string, cars: QueryDocumentSnapshot[]) {
  let photosOk = true
  for (const snap of cars) {
    const data = snap.data()
    try {
      if (carDeleteDecision(serverCarFrom(snap.id, data), uid) === 'mark') await snap.ref.update({ deletedAt: FieldValue.serverTimestamp() })
      const { photo } = await purgeCar(snap.ref, data)
      if (photo === 'pending') photosOk = false
    } catch (e) {
      if (!isNotFound(e)) throw e
    }
  }
  return photosOk
}

/**
 * Los registros que cargó en autos de otras personas (trabajos, cargas y lecturas de km con `createdBy == uid`, también
 * en los autos de los que ya salió) quedan en el historial del dueño, sin su nombre: `createdByName: null` (la app
 * muestra "otra persona", `authorLabel`). Los datos no cambian, así no cambian los gastos ni los mantenimientos. Usa
 * consultas de grupo (`collectionGroup`), que necesitan los índices de `firestore.indexes.json`. Sólo escribe los que
 * todavía tienen el nombre.
 */
async function anonymizeRecords(db: Firestore, uid: string, ownedCarIds: ReadonlySet<string>) {
  for (const collection of AUTHORED_COLLECTIONS) {
    const snap = await db.collectionGroup(collection).where('createdBy', '==', uid).select('createdByName').get()
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
 * Borra la cuenta con el Admin SDK. Antes de tocar nada, si tiene autos propios con miembros (`carsBlockingAccountDeletion`)
 * devuelve `blocked`. Si no, en este orden, y cada paso tolera que ya esté hecho (se puede volver a llamar si se corta
 * a mitad de camino, por ejemplo por `maxDuration`):
 * 1. Sus autos: `purgeOwnedCars` (un auto que ya no existe no se lee).
 * 2. Sus registros en autos de otras personas, sin su nombre (`anonymizeRecords`; sólo los que lo tienen).
 * 3. Sale de los autos compartidos (`leaveSharedCars`; `arrayRemove` y `delete` de un campo que no está no fallan).
 * 4. Sus invitaciones, mandadas y recibidas (`deleteInvites`; las borradas no aparecen en la consulta).
 * 5. `usage/{uid}` (borrar un documento que no existe no falla).
 * 6. Sus fotos en Cloudinary por carpeta (`deleteImagesByPrefix`; carpeta vacía = ok). Si Cloudinary falló aquí o en el
 *    paso 1, devuelve `photos-pending` sin seguir: la cuenta sigue y se puede reintentar.
 * 7. `allowlist/{mail}`: desde acá las reglas de Firestore rechazan todo lo que mande la app con esta cuenta, así un
 *    dispositivo abierto no vuelve a crear `users/{uid}` (`subscribeUserData` lo crea si falta).
 * 8. `users/{uid}` con sus subcolecciones (`recursiveDelete`: ajustes, suscripciones push, logros, `ruleNotices` y las
 *    colecciones viejas de antes de la migración).
 * 9. La cuenta de Firebase Auth (`deleteUser`; `auth/user-not-found` = ya borrada). Va última: mientras exista, el
 *    mismo token sirve para reintentar, y después `/api/access` (que verifica que la cuenta exista) ya no la vuelve a
 *    registrar.
 */
export async function deleteAccount(uid: string, email: string): Promise<AccountDeletion> {
  const db = adminDb()
  const owned = (await db.collection('cars').where('ownerUid', '==', uid).get()).docs
  const blocking = carsBlockingAccountDeletion(
    owned.map(d => serverCarFrom(d.id, d.data())),
    uid,
  )
  if (blocking.length) return { status: 'blocked', cars: blocking }

  const carPhotosOk = await purgeOwnedCars(uid, owned)
  await anonymizeRecords(db, uid, new Set(owned.map(d => d.id)))
  await leaveSharedCars(db, uid)
  await deleteInvites(db, uid, email)
  await db.collection('usage').doc(uid).delete()
  const images = await deleteImagesByPrefix(accountImagePrefix(uid))
  if (!carPhotosOk || !images.ok) {
    if (!images.ok) console.error('Borrado de cuenta: no se pudieron borrar las fotos', uid, images.error)
    return { status: 'photos-pending' }
  }
  await accountRef(email).delete()
  await db.recursiveDelete(db.collection('users').doc(uid))
  try {
    await adminAuth().deleteUser(uid)
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e
  }
  return { status: 'deleted' }
}
