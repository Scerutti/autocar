/**
 * Vincula cada lectura de km con la carga o el trabajo que la generó (`{source}-{id}` con `sourceId`), completa las
 * lecturas que faltan y deja en cada auto el `currentKm` como su lectura más alta (lectura `baseline-{carId}`).
 * La lógica está en `link-readings-plan.mjs`.
 *
 * Uso: node --env-file=.env.local scripts/link-readings.mjs [--apply]
 *
 * Sin --apply es un simulacro: lee, cuenta e informa, pero no escribe nada. Se puede volver a correr: lo que ya
 * está vinculado no se toca. Usa el Admin SDK (no pasa por las reglas ni depende de la app nueva) con las mismas
 * variables FIREBASE_ADMIN_* que `adminApp()` en lib/firebase/admin.ts. No imprime variables de entorno ni datos
 * de la service account.
 *
 * Orden de los pasos manuales:
 * 1. Publicar las reglas de Firestore nuevas.
 * 2. Simulacro: `node --env-file=.env.local scripts/link-readings.mjs`.
 * 3. `node --env-file=.env.local scripts/link-readings.mjs --apply`.
 * 4. Deploy de la app.
 * 5. `--apply` otra vez: vincula lo que haya escrito la versión anterior de la PWA hasta actualizarse. Una tercera
 *    corrida tiene que dar 0 cambios.
 * Va antes del deploy porque la app nueva recalcula el km del auto desde sus lecturas, y un auto viejo con
 * `currentKm` mayor que sus lecturas bajaría si todavía no tiene su lectura baseline.
 *
 * Las lecturas ambiguas (más de un registro con el mismo km) y las sin candidato (por ejemplo, la de una carga que
 * se borró) quedan como están y se listan: se revisan en la pestaña Km de cada auto, donde se pueden borrar.
 */

import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { packGroups, planCarLinks } from './link-readings-plan.mjs'

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
  const [readings, fuel, jobs] = await Promise.all(['odometer', 'fuel', 'jobs'].map(name => ref.collection(name).get()))
  return { car, readings: toDocs(readings), fuel: toDocs(fuel), jobs: toDocs(jobs) }
}

/** Escribe los grupos en tandas de como mucho 450 operaciones, sin partir un grupo. Devuelve cuántas escribió. */
async function writeAll(db, groups) {
  let written = 0
  for (const ops of packGroups(groups)) {
    const batch = db.batch()
    for (const op of ops) {
      if (op.op === 'delete') batch.delete(db.doc(op.path))
      else batch.set(db.doc(op.path), op.data)
    }
    await batch.commit()
    written += ops.length
  }
  return written
}

function describe(report) {
  return [
    `baseline ${report.baseline}`,
    `vinculadas ${report.linked}`,
    `ambiguas ${report.ambiguous.length}`,
    `sin candidato ${report.unmatched.length}`,
    `completadas ${report.completed}`,
  ].join(', ')
}

async function main() {
  initAdmin()
  const db = getFirestore()
  console.log(apply ? 'Migración (--apply): escribe en cars/*/odometer.' : 'Simulacro: no escribe nada. Usá --apply para escribir.')

  const cars = toDocs(await db.collection('cars').get())
  const totals = { baseline: 0, linked: 0, ambiguous: 0, unmatched: 0, completed: 0, writes: 0, written: 0 }
  for (const car of cars) {
    const { groups, report } = planCarLinks(await readCar(db, car))
    const count = groups.reduce((n, g) => n + g.length, 0)
    totals.baseline += report.baseline
    totals.linked += report.linked
    totals.ambiguous += report.ambiguous.length
    totals.unmatched += report.unmatched.length
    totals.completed += report.completed
    totals.writes += count
    if (!count && !report.ambiguous.length && !report.unmatched.length) continue

    console.log(`\nAuto ${car.id}: ${describe(report)}`)
    report.ambiguous.forEach(r => console.log(`  AMBIGUA ${r.path} (${r.source}, ${r.km} km): candidatos ${r.candidates.join(', ')}`))
    report.unmatched.forEach(r => console.log(`  SIN CANDIDATO ${r.path} (${r.source}, ${r.km} km)`))
    if (apply && count) {
      const written = await writeAll(db, groups)
      totals.written += written
      console.log(`  Escritas ${written} operaciones`)
    }
  }

  console.log(
    `\nTotal: ${cars.length} autos, ${totals.writes} operaciones. Baseline ${totals.baseline}, vinculadas ${totals.linked}, ` +
      `completadas ${totals.completed}, ambiguas ${totals.ambiguous}, sin candidato ${totals.unmatched}.`,
  )
  if (apply) console.log(`Escritas: ${totals.written}.`)
  if (!totals.writes) console.log('Sin cambios.')
}

main().catch(e => {
  console.error('La migración falló:', e.message)
  process.exitCode = 1
})
