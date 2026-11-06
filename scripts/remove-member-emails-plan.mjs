import { canonicalEmail } from './members-to-uids-plan.mjs'

const strings = v => (Array.isArray(v) ? v.filter(m => typeof m === 'string') : [])

/**
 * Decide si se puede borrar `members` (los mails viejos) de un auto, a partir de lo que ya se leyó de Firestore y de
 * Firebase Auth. No toca nada: lo corre `remove-member-emails.mjs` y lo prueba vitest.
 *
 * `car` viene como `{ id, data }`. `ownerEmail` es el mail de la cuenta del dueño (null si no se leyó o no tiene). Cada
 * mail de `members` se compara con `canonicalEmail`:
 * - **Con uid** (`covered`): es el `email` del perfil (`memberProfiles`) de un uid que está en `memberUids`. Ya es
 *   miembro por uid: no pierde el acceso.
 * - **Del dueño** (`owner`): es el mail del dueño. Ve el auto como dueño.
 * - **Sin uid** (`missing`): no es de ningún miembro por uid. Si se borra, esa persona deja de ver el auto.
 *
 * Si todos los mails tienen uid o son del dueño (o `members` está vacío), devuelve `carUpdate` (`{ path }`: borrar el
 * campo `members`). Si hay alguno sin uid, `carUpdate` es null y el auto no se toca. Un auto sin el campo `members` no
 * cambia (`status: 'none'`), así que se puede volver a correr.
 */
export function planRemoveMembers({ car, ownerEmail }) {
  const report = { carId: car.id, status: 'none', covered: [], owner: [], missing: [] }
  if (!Object.hasOwn(car.data, 'members')) return { carUpdate: null, report }

  const uids = strings(car.data.memberUids)
  const profiles = car.data.memberProfiles && typeof car.data.memberProfiles === 'object' ? car.data.memberProfiles : {}
  const byEmail = new Map()
  for (const uid of uids) {
    const email = profiles[uid]?.email
    if (typeof email === 'string' && email) byEmail.set(canonicalEmail(email), uid)
  }
  const ownerKey = ownerEmail ? canonicalEmail(ownerEmail) : null

  for (const mail of strings(car.data.members)) {
    const key = canonicalEmail(mail)
    const uid = byEmail.get(key)
    if (uid) report.covered.push({ mail, uid })
    else if (key === ownerKey) report.owner.push(mail)
    else report.missing.push(mail)
  }

  if (report.missing.length) {
    report.status = 'keep'
    return { carUpdate: null, report }
  }
  report.status = 'remove'
  return { carUpdate: { path: `cars/${car.id}` }, report }
}
