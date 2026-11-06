/**
 * Borra el campo `members` (los mails viejos de los autos compartidos) de cada auto, después de confirmar que cada mail
 * es el de un miembro por uid (el `email` de su perfil en `memberProfiles`, con su uid en `memberUids`) o el del dueño.
 * Un auto con algún mail sin uid no se toca y se informa: esa persona dejaría de ver el auto. La lógica está en
 * `remove-member-emails-plan.mjs`.
 *
 * Uso: node --env-file=.env.local scripts/remove-member-emails.mjs [--apply]
 *
 * Sin --apply es un simulacro: lee, decide e informa, pero no escribe nada. Se puede volver a correr: un auto sin
 * `members` no se toca. Cada auto se escribe con la condición de que no haya cambiado desde que se leyó (si cambió, se
 * informa y se saltea: volver a correr). Usa el Admin SDK (no pasa por las reglas) con las mismas variables
 * FIREBASE_ADMIN_* que `adminApp()` en lib/firebase/admin.ts. No imprime variables de entorno ni datos de la service
 * account.
 *
 * Orden de los pasos manuales (después de `members-to-uids.mjs` y al menos una release después de las invitaciones,
 * para que la PWA ya esté actualizada):
 * 1. Simulacro: `node --env-file=.env.local scripts/remove-member-emails.mjs`.
 * 2. Si informa autos con mails sin uid: resolverlos antes de seguir (que esa persona acepte una invitación, o sacar el
 *    mail con la app de antes de este cambio, Compartir → Sacar, o desde la consola de Firebase) y volver al paso 1.
 * 3. `node --env-file=.env.local scripts/remove-member-emails.mjs --apply`. Una segunda corrida tiene que dar 0 cambios.
 * 4. Publicar las reglas de Firestore nuevas (sin `members`).
 * 5. Deploy de la app.
 * Con las reglas nuevas, un auto que todavía tenga mails en `members` no se puede editar: no publicarlas mientras el
 * simulacro informe autos que no se tocan.
 */

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { planRemoveMembers } from './remove-member-emails-plan.mjs'

const apply = process.argv.includes('--apply')

function initAdmin() {
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Faltan FIREBASE_ADMIN_PROJECT_ID (o NEXT_PUBLIC_FIREBASE_PROJECT_ID), FIREBASE_ADMIN_CLIENT_EMAIL o FIREBASE_ADMIN_PRIVATE_KEY.')
  }
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId })
}

/** El mail de la cuenta del dueño, o null si no se pudo leer (el mail cuenta como sin uid). */
async function ownerEmailOf(auth, uid) {
  if (typeof uid !== 'string' || !uid) return null
  try {
    return (await auth.getUser(uid)).email ?? null
  } catch (e) {
    console.warn(`  No se pudo leer la cuenta del dueño (${e?.code ?? e?.message ?? 'error'})`)
    return null
  }
}

async function main() {
  initAdmin()
  const db = getFirestore()
  const auth = getAuth()
  console.log(apply ? 'Borrado (--apply): escribe en cars/*.' : 'Simulacro: no escribe nada. Usá --apply para escribir.')

  const snaps = (await db.collection('cars').get()).docs
  const totals = { remove: 0, keep: 0, written: 0, conflicts: 0 }
  for (const snap of snaps) {
    const car = { id: snap.id, data: snap.data() }
    let plan = planRemoveMembers({ car, ownerEmail: null })
    if (plan.report.status === 'none') continue
    if (plan.report.status === 'keep') plan = planRemoveMembers({ car, ownerEmail: await ownerEmailOf(auth, car.data.ownerUid) })
    const { carUpdate, report } = plan

    const name = `${car.data.brand ?? ''} ${car.data.model ?? ''}`.trim()
    console.log(`\nAuto ${car.id}${name ? ` (${name})` : ''}:`)
    if (report.covered.length) console.log(`  Con uid: ${report.covered.map(c => `${c.mail} → ${c.uid}`).join(', ')}`)
    if (report.owner.length) console.log(`  Del dueño: ${report.owner.join(', ')}`)
    if (!carUpdate) {
      totals.keep++
      console.log(`  No se toca: sin uid ${report.missing.join(', ')}`)
      continue
    }
    totals.remove++
    console.log('  Se borra members')
    if (!apply) continue
    try {
      await db.doc(carUpdate.path).update({ members: FieldValue.delete() }, { lastUpdateTime: snap.updateTime })
      totals.written++
      console.log('  Escrito')
    } catch (e) {
      totals.conflicts++
      console.log(`  No se escribió: el auto cambió desde que se leyó (${e?.code ?? e?.message ?? 'error'}). Volver a correr.`)
    }
  }

  console.log(`\nTotal: ${totals.remove} autos para borrar members, ${totals.keep} que no se tocan (mails sin uid).`)
  if (apply) console.log(`Autos escritos: ${totals.written}. Sin escribir porque cambiaron: ${totals.conflicts}.`)
  if (!totals.remove && !totals.keep) console.log('Sin cambios: ningún auto tiene members.')
  if (totals.keep) console.log('No publicar las reglas nuevas hasta que ningún auto quede sin tocar.')
}

main().catch(e => {
  console.error('El borrado falló:', e.message)
  process.exitCode = 1
})
