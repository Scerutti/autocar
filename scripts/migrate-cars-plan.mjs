/** Subcolecciones de un auto, en la estructura vieja (users/{uid}/…) y en la nueva (cars/{carId}/…). */
export const CHILD_COLLECTIONS = ['rules', 'jobs', 'fuel', 'odometer']

/** Subcolecciones donde se graba quién cargó el registro. Los mantenimientos se copian tal cual. */
const AUTHORED = new Set(['jobs', 'fuel', 'odometer'])

/** Estado de la migración de una cuenta: cuántos documentos de cada tipo se copian, se saltean o se omiten. */
function emptyReport(uid) {
  const report = { uid, cars: { copy: 0, skip: 0, conflict: 0 }, orphans: [], conflicts: [] }
  for (const name of CHILD_COLLECTIONS) report[name] = { copy: 0, skip: 0, orphan: 0, conflict: 0 }
  return report
}

/**
 * Decide qué escribir y qué informar para una cuenta, a partir de lo que ya se leyó de Firestore. No toca
 * Firestore: lo corre `migrate-cars.mjs` y lo prueba vitest.
 *
 * `source` trae los documentos viejos de la cuenta como `{ id, data }` (`cars`, `rules`, `jobs`, `fuel`,
 * `odometer`). `existing` trae lo que ya hay en la estructura nueva: `cars` es un Map de id de auto a
 * `ownerUid`, y `children` un Set de rutas `cars/{carId}/{colección}/{id}`.
 *
 * Solo crea: lo que ya existe en el destino se saltea. Un hijo cuyo `carId` no es un auto de la cuenta se
 * informa como huérfano, y un auto que ya existe con otro dueño se informa como conflicto (con sus hijos).
 * Devuelve `writes` con `{ path, data }` y el `report` de la cuenta.
 */
export function planAccountMigration({ uid, ownerName, source, existing }) {
  const report = emptyReport(uid)
  const writes = []
  const owned = new Set(source.cars.map(c => c.id))
  const conflicted = new Set()

  for (const car of source.cars) {
    const current = existing.cars.get(car.id)
    if (current !== undefined && current !== uid) {
      report.cars.conflict++
      report.conflicts.push({ path: `cars/${car.id}`, ownerUid: current })
      conflicted.add(car.id)
      continue
    }
    if (current !== undefined) {
      report.cars.skip++
      continue
    }
    report.cars.copy++
    writes.push({ path: `cars/${car.id}`, data: { ...car.data, ownerUid: uid, ownerName: ownerName ?? null, members: [] } })
  }

  for (const name of CHILD_COLLECTIONS) {
    for (const child of source[name]) {
      const carId = child.data.carId
      if (typeof carId !== 'string' || !owned.has(carId)) {
        report[name].orphan++
        report.orphans.push({ path: `users/${uid}/${name}/${child.id}`, carId: carId ?? null })
        continue
      }
      if (conflicted.has(carId)) {
        report[name].conflict++
        continue
      }
      const path = `cars/${carId}/${name}/${child.id}`
      if (existing.children.has(path)) {
        report[name].skip++
        continue
      }
      report[name].copy++
      const extra = AUTHORED.has(name) ? { createdBy: uid, createdByName: ownerName ?? null } : {}
      if (name === 'jobs') extra.status = 'approved'
      writes.push({ path, data: { ...child.data, ...extra } })
    }
  }

  return { writes, report }
}

/** Parte la lista en tandas de como mucho `size` elementos: un batch de Firestore admite hasta 500 operaciones. */
export function chunk(items, size = 450) {
  const out = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
