/**
 * Pasa los autos compartidos por mail (`members`) a miembros por uid (`memberUids`, `memberProfiles`). Por cada mail
 * busca la cuenta en Firebase Auth (`getUserByEmail`): si existe, suma su uid y su perfil (el mail queda en `members`
 * para la versión anterior de la PWA); si no existe (la persona nunca entró y nunca vio el auto), crea una invitación
 * pendiente y saca el mail de `members`. La lógica está en `members-to-uids-plan.mjs`.
 *
 * Uso: node --env-file=.env.local scripts/members-to-uids.mjs [--apply]
 *
 * Sin --apply es un simulacro: lee, decide e informa, pero no escribe nada. Se puede volver a correr: un mail cuyo uid
 * ya está en `memberUids` no se toca, y uno que pasó a invitación ya no está en `members`. Usa el Admin SDK (no pasa
 * por las reglas ni depende de la app nueva) con las mismas variables FIREBASE_ADMIN_* que `adminApp()` en
 * lib/firebase/admin.ts. No imprime variables de entorno ni datos de la service account.
 *
 * Orden de los pasos manuales:
 * 1. Publicar las reglas de Firestore nuevas (invitaciones, `memberUids`, `memberProfiles`).
 * 2. Deploy de la app.
 * 3. Simulacro: `node --env-file=.env.local scripts/members-to-uids.mjs`.
 * 4. `node --env-file=.env.local scripts/members-to-uids.mjs --apply`. Una segunda corrida tiene que dar 0 cambios.
 * Mientras tanto nadie pierde el acceso: las reglas y la app siguen leyendo los autos compartidos por mail.
 */

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { planCarMembers } from './members-to-uids-plan.mjs'

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

/** Lo que devuelve Auth para un mail: la cuenta, que no existe, o el error (se informa como ambiguo). */
async function lookup(auth, mail) {
  try {
    const user = await auth.getUserByEmail(mail)
    return { status: 'found', uid: user.uid, name: user.displayName ?? null }
  } catch (e) {
    if (e?.code === 'auth/user-not-found') return { status: 'missing' }
    return { status: 'error', message: e?.code ?? e?.message ?? 'error' }
  }
}

async function main() {
  initAdmin()
  const db = getFirestore()
  const auth = getAuth()
  console.log(apply ? 'Migración (--apply): escribe en cars/* e invites/*.' : 'Simulacro: no escribe nada. Usá --apply para escribir.')

  const now = new Date()
  const cars = (await db.collection('cars').get()).docs.map(d => ({ id: d.id, data: d.data() }))
  const totals = { cars: 0, migrated: 0, invited: 0, ambiguous: 0, written: 0 }
  for (const car of cars) {
    const mails = Array.isArray(car.data.members) ? car.data.members.filter(m => typeof m === 'string') : []
    if (!mails.length) continue
    const accounts = {}
    for (const mail of mails) accounts[mail] = await lookup(auth, mail)
    const invites = (await db.collection('invites').where('carId', '==', car.id).get()).docs.map(d => d.id)
    const { carUpdate, inviteCreates, report } = planCarMembers({ car, accounts, invites, now })
    totals.migrated += report.migrated.length
    totals.invited += report.invited.length
    totals.ambiguous += report.ambiguous.length
    if (!carUpdate && !report.ambiguous.length) continue

    const name = `${car.data.brand ?? ''} ${car.data.model ?? ''}`.trim()
    console.log(`\nAuto ${car.id}${name ? ` (${name})` : ''}:`)
    if (report.migrated.length) console.log(`  Pasan a miembros por uid: ${report.migrated.join(', ')}`)
    if (report.invited.length) console.log(`  Pasan a invitación pendiente: ${report.invited.join(', ')}`)
    for (const a of report.ambiguous) console.log(`  Ambiguo, no se toca: ${a.mail} (${a.reason})`)
    if (!carUpdate) continue
    totals.cars++
    if (apply) {
      const batch = db.batch()
      for (const w of inviteCreates) batch.create(db.doc(w.path), w.data)
      batch.update(db.doc(carUpdate.path), carUpdate.data)
      await batch.commit()
      totals.written++
      console.log('  Escrito')
    }
  }

  console.log(
    `\nTotal: ${totals.cars} autos para cambiar. Miembros por uid ${totals.migrated}, invitaciones ${totals.invited}, ` +
      `ambiguos ${totals.ambiguous}.`,
  )
  if (apply) console.log(`Autos escritos: ${totals.written}.`)
  if (!totals.cars) console.log('Sin cambios.')
}

main().catch(e => {
  console.error('La migración falló:', e.message)
  process.exitCode = 1
})
