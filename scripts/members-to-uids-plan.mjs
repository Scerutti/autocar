/** Cuántos días dura una invitación sin responder (INVITE_DAYS en lib/sharing.ts). */
export const INVITE_DAYS = 14

/** Cuántas personas, además del dueño, pueden tener un auto (MAX_MEMBERS en lib/sharing.ts). */
export const MAX_MEMBERS = 2

const GMAIL_DOMAINS = ['gmail.com', 'googlemail.com']

const strings = v => (Array.isArray(v) ? v.filter(m => typeof m === 'string') : [])

/** El mismo cálculo que `canonicalEmail` en lib/sharing.ts y `myEmailKey()` en firestore.rules. */
export function canonicalEmail(email) {
  const e = email.trim().toLowerCase()
  const at = e.lastIndexOf('@')
  if (at < 0 || !GMAIL_DOMAINS.includes(e.slice(at + 1))) return e
  return `${e.slice(0, at).split('+')[0].replaceAll('.', '')}@gmail.com`
}

/** "Ford Ka 2015", como `inviteCarLabel` en lib/sharing.ts. */
const carLabel = data => [data.brand, data.model, data.year].filter(Boolean).join(' ')

/**
 * Pasa los miembros por mail (`members`) de un auto a miembros por uid, a partir de lo que ya se leyó de Firestore y
 * de Firebase Auth. No toca nada: lo corre `members-to-uids.mjs` y lo prueba vitest.
 *
 * `car` viene como `{ id, data }`. `accounts` dice, por cada mail de `members`, qué devolvió `getUserByEmail`:
 * `{ status: 'found', uid, name }`, `{ status: 'missing' }` (no existe la cuenta) o `{ status: 'error', message }`.
 * `invites` son los ids de las invitaciones que ya existen. `now` es la fecha de creación de las invitaciones nuevas.
 * Por cada mail:
 * - **Tiene cuenta** (`migrated`): suma su uid a `memberUids` y su perfil (el mail y el `displayName`) a
 *   `memberProfiles`. El mail queda en `members`, para la versión anterior de la PWA. Si el uid ya estaba, no cambia
 *   nada (`skipped`).
 * - **No tiene cuenta** (`invited`): nunca entró, así que nunca vio el auto. Crea la invitación pendiente
 *   (`invites/{carId}_{mail canónico}`, vence a los `INVITE_DAYS` días) si no existe, y saca el mail de `members`.
 * - **Ambiguo** (`ambiguous`, no se toca y se informa): la cuenta es la del dueño, la lectura de Auth falló, o el auto
 *   quedaría con más de `MAX_MEMBERS` miembros por uid.
 *
 * Devuelve `carUpdate` (`{ path, data }` para un `update` del auto, o null si no cambia), `inviteCreates`
 * (`{ path, data }` para un `create`) y el `report` del auto. Si ya se corrió, no devuelve nada para escribir.
 */
export function planCarMembers({ car, accounts, invites, now }) {
  const members = strings(car.data.members)
  const memberUids = strings(car.data.memberUids)
  const memberProfiles = { ...(car.data.memberProfiles && typeof car.data.memberProfiles === 'object' ? car.data.memberProfiles : {}) }
  const report = { carId: car.id, migrated: [], invited: [], skipped: [], ambiguous: [] }
  const inviteCreates = []
  let keep = [...members]
  let changed = false

  for (const mail of members) {
    const account = accounts[mail] ?? { status: 'error', message: 'sin datos de la cuenta' }
    if (account.status === 'error') {
      report.ambiguous.push({ mail, reason: `no se pudo leer la cuenta (${account.message})` })
      continue
    }
    if (account.status === 'found') {
      if (account.uid === car.data.ownerUid) {
        report.ambiguous.push({ mail, reason: 'es la cuenta del dueño' })
        continue
      }
      if (memberUids.includes(account.uid)) {
        report.skipped.push(mail)
        continue
      }
      if (memberUids.length >= MAX_MEMBERS) {
        report.ambiguous.push({ mail, reason: `el auto ya tiene ${MAX_MEMBERS} miembros por uid` })
        continue
      }
      memberUids.push(account.uid)
      memberProfiles[account.uid] = { email: mail, name: account.name ?? null }
      report.migrated.push(mail)
      changed = true
      continue
    }
    const emailKey = canonicalEmail(mail)
    const id = `${car.id}_${emailKey}`
    if (!invites.includes(id) && !inviteCreates.some(w => w.path === `invites/${id}`)) {
      inviteCreates.push({
        path: `invites/${id}`,
        data: {
          carId: car.id,
          ownerUid: car.data.ownerUid,
          ownerName: car.data.ownerName ?? null,
          carLabel: carLabel(car.data),
          email: mail,
          emailKey,
          status: 'pending',
          createdAt: now,
          expiresAt: new Date(now.getTime() + INVITE_DAYS * 24 * 60 * 60 * 1000),
          respondedAt: null,
          acceptedUid: null,
        },
      })
    }
    keep = keep.filter(m => m !== mail)
    report.invited.push(mail)
    changed = true
  }

  const carUpdate = changed ? { path: `cars/${car.id}`, data: { members: keep, memberUids, memberProfiles } } : null
  return { carUpdate, inviteCreates, report }
}
