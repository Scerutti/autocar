/**
 * Separa en cada mantenimiento la "última vez" que cargó el dueño (la base: `baseKm`, `baseDate`) de la que dejó un
 * trabajo. Escribe la base de los mantenimientos que todavía no la tienen; la lógica está en `rebase-rules-plan.mjs`.
 * La proyección (`lastDoneJobId`, `completedByJobId`) no la escribe: la calcula y la guarda la app cuando el dueño la
 * abre, y hasta entonces el cron sigue con los `lastDone*` guardados, que el script no toca.
 *
 * Uso: node --env-file=.env.local scripts/rebase-rules.mjs [--apply]
 *
 * Sin --apply es un simulacro: lee, cuenta e informa, pero no escribe nada. Se puede volver a correr: un mantenimiento
 * que ya tiene los dos campos (aunque sean null) no se toca. Usa el Admin SDK (no pasa por las reglas ni depende de la
 * app nueva) con las mismas variables FIREBASE_ADMIN_* que `adminApp()` en lib/firebase/admin.ts. No imprime
 * variables de entorno ni datos de la service account.
 *
 * Orden de los pasos manuales:
 * 1. Publicar las reglas de Firestore nuevas (aceptan `baseKm`, `baseDate`, `lastDoneJobId` y `completedByJobId`).
 * 2. Simulacro: `node --env-file=.env.local scripts/rebase-rules.mjs`.
 * 3. `node --env-file=.env.local scripts/rebase-rules.mjs --apply`.
 * 4. Deploy de la app.
 * 5. `--apply` otra vez: completa los mantenimientos que haya creado o editado la versión anterior de la PWA hasta
 *    actualizarse (reescribe el documento completo y se lleva la base). Una tercera corrida tiene que dar 0 cambios.
 * Va antes del deploy porque la app nueva, en un mantenimiento sin base, usa como base la "última vez" guardada: si esa
 * fecha la puso un trabajo, borrar o corregir el trabajo no lo haría volver atrás.
 */

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { chunk, planCarRebase } from './rebase-rules-plan.mjs'

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

const toDocs = snap => snap.docs.map(d => ({ id: d.id, data: d.data() }))

async function readCar(db, car) {
  const ref = db.collection('cars').doc(car.id)
  const [rules, jobs] = await Promise.all(['rules', 'jobs'].map(name => ref.collection(name).get()))
  return { car, rules: toDocs(rules), jobs: toDocs(jobs) }
}

/**
 * Escribe la base con `update` en tandas de como mucho 450: si un mantenimiento se borró mientras corría, la tanda
 * falla en vez de crear un documento suelto. Devuelve cuántas escribió.
 */
async function writeAll(db, writes) {
  let written = 0
  for (const group of chunk(writes)) {
    const batch = db.batch()
    for (const w of group) batch.update(db.doc(w.path), w.data)
    await batch.commit()
    written += group.length
  }
  return written
}

async function main() {
  initAdmin()
  const db = getFirestore()
  console.log(apply ? 'Migración (--apply): escribe en cars/*/rules.' : 'Simulacro: no escribe nada. Usá --apply para escribir.')

  const cars = toDocs(await db.collection('cars').get())
  const totals = { own: 0, fromJob: 0, skipped: 0, writes: 0, written: 0 }
  for (const car of cars) {
    const { writes, report } = planCarRebase(await readCar(db, car))
    totals.own += report.own
    totals.fromJob += report.fromJob
    totals.skipped += report.skipped
    totals.writes += writes.length
    if (!writes.length) continue

    const name = `${car.data.brand ?? ''} ${car.data.model ?? ''}`.trim()
    console.log(
      `\nAuto ${car.id}${name ? ` (${name})` : ''}: ${report.own} con base propia, ${report.fromJob} con base null ` +
        `(explicados por un trabajo), ${report.skipped} ya tenían base.`,
    )
    if (apply) {
      const written = await writeAll(db, writes)
      totals.written += written
      console.log(`  Escritos ${written} mantenimientos`)
    }
  }

  console.log(
    `\nTotal: ${cars.length} autos, ${totals.writes} mantenimientos para completar. Base propia ${totals.own}, ` +
      `base null (explicados por un trabajo) ${totals.fromJob}, ya tenían base ${totals.skipped}.`,
  )
  if (apply) console.log(`Escritos: ${totals.written}.`)
  if (!totals.writes) console.log('Sin cambios.')
}

main().catch(e => {
  console.error('La migración falló:', e.message)
  process.exitCode = 1
})
