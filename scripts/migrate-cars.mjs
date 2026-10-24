/**
 * Copia los autos y todo lo que cuelga de ellos de users/{uid}/… a cars/{carId}/…, con los mismos ids.
 *
 * Uso: node --env-file=.env.local scripts/migrate-cars.mjs [--apply]
 *
 * Sin --apply es un simulacro: lee, cuenta e informa, pero no escribe nada. Solo crea: si el documento
 * destino ya existe lo saltea, así se puede volver a correr sin pisar lo cargado con la app nueva. No borra
 * nada de users/{uid}/…. Usa las mismas variables FIREBASE_ADMIN_* que `adminApp()` en lib/firebase/admin.ts
 * (ese archivo es TypeScript y tiene `import 'server-only'`, por eso no se importa). No imprime variables de
 * entorno ni datos de la service account.
 */

import { cert, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { CHILD_COLLECTIONS, chunk, planAccountMigration } from './migrate-cars-plan.mjs'

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

async function readSource(db, uid) {
  const user = db.collection('users').doc(uid)
  const [cars, rules, jobs, fuel, odometer] = await Promise.all(
    ['cars', ...CHILD_COLLECTIONS].map(name => user.collection(name).get()),
  )
  return { cars: toDocs(cars), rules: toDocs(rules), jobs: toDocs(jobs), fuel: toDocs(fuel), odometer: toDocs(odometer) }
}

async function readExisting(db, carIds) {
  const cars = new Map()
  const children = new Set()
  await Promise.all(
    carIds.map(async carId => {
      const car = await db.collection('cars').doc(carId).get()
      if (car.exists) cars.set(carId, car.data().ownerUid ?? null)
      for (const name of CHILD_COLLECTIONS) {
        const refs = await db.collection('cars').doc(carId).collection(name).listDocuments()
        refs.forEach(r => children.add(`cars/${carId}/${name}/${r.id}`))
      }
    }),
  )
  return { cars, children }
}

async function ownerNameOf(uid) {
  try {
    return (await getAuth().getUser(uid)).displayName || null
  } catch {
    return null
  }
}

/** Crea los documentos en tandas de 450. Si una tanda choca con un documento que apareció en el medio, los crea de a uno. */
async function writeAll(db, writes) {
  let created = 0
  let existed = 0
  for (const group of chunk(writes, 450)) {
    const batch = db.batch()
    group.forEach(w => batch.create(db.doc(w.path), w.data))
    try {
      await batch.commit()
      created += group.length
    } catch (e) {
      if (e.code !== 6) throw e
      for (const w of group) {
        try {
          await db.doc(w.path).create(w.data)
          created++
        } catch (err) {
          if (err.code !== 6) throw err
          existed++
        }
      }
    }
  }
  return { created, existed }
}

function describe(report) {
  const parts = [`autos ${report.cars.copy} copia, ${report.cars.skip} saltea, ${report.cars.conflict} en conflicto`]
  for (const name of CHILD_COLLECTIONS) {
    const r = report[name]
    parts.push(`${name} ${r.copy} copia, ${r.skip} saltea, ${r.orphan} huérfanos, ${r.conflict} en conflicto`)
  }
  return parts.join(' | ')
}

async function main() {
  initAdmin()
  const db = getFirestore()
  console.log(apply ? 'Migración (--apply): escribe en cars/.' : 'Simulacro: no escribe nada. Usá --apply para migrar.')

  const accounts = await db.collection('users').listDocuments()
  let conflicts = 0
  let orphans = 0
  let toCopy = 0
  let written = 0
  for (const account of accounts) {
    const uid = account.id
    const source = await readSource(db, uid)
    if (!source.cars.length && !CHILD_COLLECTIONS.some(name => source[name].length)) continue
    const existing = await readExisting(db, source.cars.map(c => c.id))
    const { writes, report } = planAccountMigration({ uid, ownerName: await ownerNameOf(uid), source, existing })
    console.log(`\nCuenta ${uid}: ${describe(report)}`)
    report.conflicts.forEach(c => console.log(`  CONFLICTO ${c.path} ya existe con otro dueño (${c.ownerUid})`))
    report.orphans.forEach(o => console.log(`  HUÉRFANO ${o.path} (carId ${o.carId}) no se copia`))
    conflicts += report.conflicts.length
    orphans += report.orphans.length
    toCopy += writes.length
    if (apply && writes.length) {
      const result = await writeAll(db, writes)
      written += result.created
      console.log(`  Escritos ${result.created}${result.existed ? `, ${result.existed} ya existían` : ''}`)
    }
  }

  console.log(`\nTotal: ${toCopy} documentos para copiar, ${orphans} huérfanos, ${conflicts} conflictos.`)
  if (apply) console.log(`Escritos: ${written}.`)
  if (conflicts) {
    console.log('HAY CONFLICTOS: revisalos antes de seguir.')
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error('La migración falló:', e.message)
  process.exitCode = 1
})
