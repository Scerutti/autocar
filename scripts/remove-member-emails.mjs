/**
 * Borra el campo `members` (los mails viejos de los autos compartidos) de cada auto, después de confirmar que cada mail
 * es el de un miembro por uid (el `email` de su perfil en `memberProfiles`, con su uid en `memberUids`) o el del dueño.
 * Un auto con algún mail sin uid no se toca y se informa: esa persona dejaría de ver el auto. La lógica está en
 * `remove-member-emails-plan.mjs`.
 *
 * Uso: node --env-file=.env.local scripts/remove-member-emails.mjs [--apply]
 *
 * Sin --apply es un simulacro: lee, decide e informa, pero no escribe nada. Se puede volver a correr: un auto sin
 * `members` no se toca. Cada auto se escribe con la condición de que no haya cambiado desde que se leyó: si cambió
 * (`FAILED_PRECONDITION`, código 9) se informa como conflicto y se saltea; cualquier otro error se informa como error.
 * Termina con código 1 si queda algún auto sin tocar, en conflicto o con error. Usa el Admin SDK (no pasa por las
 * reglas) con las mismas variables FIREBASE_ADMIN_* que `adminApp()` en lib/firebase/admin.ts. No imprime variables
 * de entorno ni datos de la service account.
 *
 * Orden de los pasos manuales (después de `members-to-uids.mjs` y al menos una release después de las invitaciones,
 * para que la PWA ya esté actualizada):
 * 1. Simulacro: `node --env-file=.env.local scripts/remove-member-emails.mjs`.
 * 2. Si informa autos con mails sin uid: resolverlos (que esa persona acepte una invitación, o sacar el mail con la
 *    app de antes de este cambio, Compartir → Sacar, o desde la consola de Firebase) y volver al paso 1.
 * 3. `node --env-file=.env.local scripts/remove-member-emails.mjs --apply`.
 * 4. Publicar las reglas de Firestore nuevas.
 * 5. Deploy de la app.
 * 6. `--apply` otra vez: la PWA anterior que siga abierta puede volver a escribir `members: []` (al crear un auto, sacar
 *    un miembro, salir o pasar el auto). Una tercera corrida tiene que dar "Sin cambios".
 * Las reglas nuevas no le dan acceso a nadie por `members` y aceptan un auto al que todavía le quedan mails (no los
 * dejan crecer), así que publicarlas antes no traba ningún auto; igual, para cerrar #66 no tiene que quedar ninguno.
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
  const totals = { remove: 0, keep: 0, written: 0, conflicts: 0, errors: 0 }
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
      if (isConflict(e)) {
        totals.conflicts++
        console.log('  No se escribió: el auto cambió desde que se leyó. Volver a correr.')
      } else {
        totals.errors++
        console.log(`  Error, no se escribió: ${e?.code ?? ''} ${e?.message ?? 'error'}`.trimEnd())
      }
    }
  }

  console.log(`\nTotal: ${totals.remove} autos para borrar members, ${totals.keep} que no se tocan (mails sin uid).`)
  if (apply) {
    console.log(`Autos escritos: ${totals.written}. En conflicto (cambiaron): ${totals.conflicts}. Con error: ${totals.errors}.`)
  }
  if (!totals.remove && !totals.keep) console.log('Sin cambios: ningún auto tiene members.')
  if (totals.keep || totals.conflicts || totals.errors) {
    console.log('No publicar las reglas nuevas hasta que ningún auto quede con mails en members: resolverlos y volver a correr.')
    process.exitCode = 1
  }
}

/** Si la escritura falló porque el auto cambió desde que se leyó (precondición `lastUpdateTime`). */
function isConflict(e) {
  return e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION'
}

main().catch(e => {
  console.error('El borrado falló:', e.message)
  process.exitCode = 1
})
