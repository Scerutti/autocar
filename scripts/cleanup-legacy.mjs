/**
 * Borra los documentos viejos de `users/{uid}/cars|rules|jobs|fuel|odometer` (la estructura de antes de la 1.1.2) cuya
 * copia en `cars/{carId}/…` está probada. La lógica está en `cleanup-legacy-plan.mjs`.
 *
 * Uso: node --env-file=.env.local scripts/cleanup-legacy.mjs [--apply]
 *
 * Sin --apply es un simulacro: lee, decide e informa, pero no borra nada. Sólo lee `cars/…` (nunca lo escribe) y sólo
 * borra rutas `users/{uid}/{cars|rules|jobs|fuel|odometer}/{id}` (`isLegacyPath`); no toca `users/{uid}`, sus logros,
 * sus suscripciones push ni sus `ruleNotices`. Un documento viejo se borra sólo si su copia existe (mismo id y mismos
 * campos que no se editan; las lecturas de km, por id, por `sourceId` o por km, origen y día) y un auto viejo, sólo si
 * se borran todos sus hijos viejos. Lo que queda se informa con el motivo.
 *
 * Con --apply, antes de borrar escribe en la carpeta donde se corre `legacy-backup-<fecha>.json` con la ruta y los
 * datos de cada documento que va a borrar, y lo vuelve a leer para verificarlo; si algo falla, no borra nada. Cada
 * documento se borra con la condición de que no haya cambiado desde que se leyó (`lastUpdateTime`): si cambió se
 * informa como conflicto. Se puede volver a correr: una segunda corrida con --apply no borra nada. Termina con código
 * 1 si queda algún documento viejo, hubo un conflicto o un error.
 *
 * Usa el Admin SDK (no pasa por las reglas) con las mismas variables FIREBASE_ADMIN_* que `adminApp()` en
 * lib/firebase/admin.ts. No imprime variables de entorno ni datos de la service account.
 *
 * Orden de los pasos manuales:
 * 1. Publicar las reglas de Firestore nuevas (las rutas viejas quedan sólo para leer y borrar).
 * 2. Simulacro: `node --env-file=.env.local scripts/cleanup-legacy.mjs`.
 * 3. Revisar el informe: lo que queda (sin copia, ambiguo, con la copia distinta) no se borra; decidir a mano.
 * 4. `node --env-file=.env.local scripts/cleanup-legacy.mjs --apply`.
 * 5. Guardar el archivo `legacy-backup-<fecha>.json` fuera del repo (está en .gitignore): es la única copia de lo
 *    borrado.
 * 6. Una segunda corrida con --apply tiene que borrar 0.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cert, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import {
  KEEP_REASONS,
  LEGACY_COLLECTIONS,
  backupFileName,
  buildBackup,
  isLegacyPath,
  planAccountCleanup,
  referencedCarIds,
} from './cleanup-legacy-plan.mjs'

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

/** Lee las colecciones viejas de una cuenta. Devuelve los documentos `{ id, data }` y el `updateTime` de cada ruta. */
async function readLegacy(db, uid) {
  const user = db.collection('users').doc(uid)
  const snaps = await Promise.all(LEGACY_COLLECTIONS.map(name => user.collection(name).get()))
  const legacy = {}
  const updateTimes = new Map()
  LEGACY_COLLECTIONS.forEach((name, i) => {
    legacy[name] = snaps[i].docs.map(d => {
      updateTimes.set(d.ref.path, d.updateTime)
      return { id: d.id, data: d.data() }
    })
  })
  const withChildren = new Set()
  await Promise.all(
    legacy.cars.map(async car => {
      const subs = await user.collection('cars').doc(car.id).listCollections()
      if (subs.length) withChildren.add(car.id)
    }),
  )
  return { legacy, updateTimes, withChildren }
}

/** Lee `cars/{carId}` y sus subcolecciones, sólo para comparar. No escribe nada en `cars/`. */
async function readCurrent(db, carIds) {
  const current = new Map()
  await Promise.all(
    carIds.map(async carId => {
      const ref = db.collection('cars').doc(carId)
      const snap = await ref.get()
      if (!snap.exists) {
        current.set(carId, { car: null, rules: new Map(), jobs: new Map(), fuel: new Map(), odometer: [] })
        return
      }
      const [rules, jobs, fuel, odometer] = await Promise.all(['rules', 'jobs', 'fuel', 'odometer'].map(name => ref.collection(name).get()))
      const toMap = s => new Map(s.docs.map(d => [d.id, d.data()]))
      current.set(carId, {
        car: snap.data(),
        rules: toMap(rules),
        jobs: toMap(jobs),
        fuel: toMap(fuel),
        odometer: odometer.docs.map(d => ({ id: d.id, data: d.data() })),
      })
    }),
  )
  return current
}

/** Imprime lo que pasa con cada documento viejo de una cuenta, agrupado por auto. */
function printReport(report) {
  console.log(`\nCuenta ${report.uid}: ${report.deleted.length} ${apply ? 'para borrar' : 'se borrarían'}, ${report.kept.length} quedan`)
  const groups = new Map()
  const groupOf = carId => {
    const key = carId ?? '(sin auto)'
    if (!groups.has(key)) groups.set(key, { deleted: [], kept: [] })
    return groups.get(key)
  }
  report.deleted.forEach(d => groupOf(d.carId).deleted.push(d))
  report.kept.forEach(k => groupOf(k.carId).kept.push(k))
  for (const [carId, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    console.log(`  Auto ${carId}: ${group.deleted.length} ${apply ? 'para borrar' : 'se borrarían'}, ${group.kept.length} quedan`)
    group.deleted.forEach(d => console.log(`    BORRA ${d.path} (copia: ${d.via})`))
    group.kept.forEach(k => console.log(`    QUEDA ${k.path}: ${KEEP_REASONS[k.reason] ?? k.reason}${k.detail ? ` (${k.detail})` : ''}`))
  }
}

/** Escribe el respaldo, lo vuelve a leer y verifica que tenga cada documento. Tira error si algo no coincide. */
function writeBackup(deletes) {
  const file = resolve(process.cwd(), backupFileName())
  const backup = buildBackup(deletes)
  writeFileSync(file, JSON.stringify(backup, null, 2), { encoding: 'utf8', flag: 'wx' })
  const read = JSON.parse(readFileSync(file, 'utf8'))
  const paths = new Set(read.docs?.map(d => d.path))
  if (read.docs?.length !== deletes.length || deletes.some(d => !paths.has(d.path))) {
    throw new Error('el respaldo leído no coincide con lo que se va a borrar')
  }
  return file
}

/** Si el borrado falló porque el documento cambió desde que se leyó (precondición `lastUpdateTime`). */
function isConflict(e) {
  return e?.code === 9 || e?.code === 'failed-precondition' || e?.code === 'FAILED_PRECONDITION'
}

/** Borra un documento viejo con la condición de que no haya cambiado. Se niega a borrar cualquier otra ruta. */
async function deleteLegacy(db, path, updateTime) {
  if (!isLegacyPath(path)) throw new Error(`Ruta fuera de las viejas, no se borra: ${path}`)
  await db.doc(path).delete(updateTime ? { lastUpdateTime: updateTime } : { exists: true })
}

async function main() {
  initAdmin()
  const db = getFirestore()
  console.log(apply ? 'Borrado (--apply): borra en users/{uid}/… lo que tiene copia.' : 'Simulacro: no borra nada. Usá --apply para borrar.')

  const accounts = await db.collection('users').listDocuments()
  const deletes = []
  const updateTimes = new Map()
  let kept = 0
  for (const account of accounts) {
    const uid = account.id
    const read = await readLegacy(db, uid)
    if (!LEGACY_COLLECTIONS.some(name => read.legacy[name].length)) continue
    const current = await readCurrent(db, referencedCarIds(read.legacy))
    const plan = planAccountCleanup({ uid, legacy: read.legacy, legacyCarsWithChildren: read.withChildren, current })
    printReport(plan.report)
    kept += plan.report.kept.length
    deletes.push(...plan.deletes)
    read.updateTimes.forEach((t, path) => updateTimes.set(path, t))
  }

  console.log(`\nTotal: ${deletes.length} documentos viejos ${apply ? 'para borrar' : 'se borrarían'}, ${kept} quedan.`)
  if (!deletes.length && !kept) console.log('Sin cambios: no hay documentos viejos.')

  const totals = { deleted: 0, conflicts: 0, errors: 0, skipped: 0 }
  if (apply && deletes.length) {
    let file
    try {
      file = writeBackup(deletes)
    } catch (e) {
      console.error(`No se pudo escribir el respaldo, no se borra nada: ${e?.message ?? 'error'}`)
      process.exitCode = 1
      return
    }
    console.log(`Respaldo: ${file} (${deletes.length} documentos). Guardalo fuera del repo.`)

    const done = new Set()
    for (const d of deletes) {
      if (d.children && d.children.some(path => !done.has(path))) {
        totals.skipped++
        console.log(`  No se borra ${d.path}: no se borraron todos sus hijos.`)
        continue
      }
      try {
        await deleteLegacy(db, d.path, updateTimes.get(d.path))
        done.add(d.path)
        totals.deleted++
      } catch (e) {
        if (isConflict(e)) {
          totals.conflicts++
          console.log(`  No se borró ${d.path}: cambió desde que se leyó. Volver a correr.`)
        } else {
          totals.errors++
          console.log(`  Error, no se borró ${d.path}: ${e?.code ?? ''} ${e?.message ?? 'error'}`.trimEnd())
        }
      }
    }
    console.log(
      `Borrados: ${totals.deleted}. En conflicto: ${totals.conflicts}. Con error: ${totals.errors}. Autos que no se borraron por sus hijos: ${totals.skipped}.`,
    )
  }

  if (kept || totals.conflicts || totals.errors || totals.skipped) {
    console.log('Quedan documentos viejos: revisá el informe antes de volver a correr.')
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error('La limpieza falló:', e.message)
  process.exitCode = 1
})
