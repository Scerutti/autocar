/** Subcolecciones viejas de users/{uid} que la app dejó de usar en la 1.1.2. Son las únicas que el script lee y borra. */
export const LEGACY_COLLECTIONS = ['cars', 'rules', 'jobs', 'fuel', 'odometer']

/** Hijos de un auto viejo, en el orden en que se borran (antes que el auto). */
export const LEGACY_CHILDREN = ['odometer', 'fuel', 'jobs', 'rules']

/** Zona horaria con la que se compara el día de una lectura de km: la de `DEFAULT_SETTINGS` en lib/types.ts. */
export const DEFAULT_TIME_ZONE = 'America/Argentina/Buenos_Aires'

/** Colección del registro que generó una lectura vinculada (`job` ≠ `jobs`), como en link-readings-plan.mjs. */
const LINKED_COLLECTIONS = { fuel: 'fuel', job: 'jobs' }

/** Un id de auto que se puede usar en una ruta de Firestore: el mismo formato que `isCarId` de lib/cars.ts. */
const CAR_ID = /^[A-Za-z0-9_-]{1,100}$/

/** Una ruta vieja: `users/{uid}/{cars|rules|jobs|fuel|odometer}/{id}`, sin nada más. */
const LEGACY_PATH = /^users\/[^/]+\/(cars|rules|jobs|fuel|odometer)\/[^/]+$/

/**
 * Si la ruta es la de un documento viejo que el script puede borrar. Cualquier otra ruta (`cars/…`, `users/{uid}`,
 * `achievements`, `pushSubscriptions`, `ruleNotices`) da false: el runner no borra nada que no pase por acá.
 */
export function isLegacyPath(path) {
  return typeof path === 'string' && LEGACY_PATH.test(path)
}

/** Ruta del documento viejo de una cuenta. Tira error si no da una ruta vieja válida. */
export function legacyPath(uid, collection, id) {
  const path = `users/${uid}/${collection}/${id}`
  if (!isLegacyPath(path)) throw new Error(`Ruta fuera de las viejas: ${path}`)
  return path
}

/** Milisegundos de un instante (`Timestamp` de Firestore, `Date` o `{ seconds, nanoseconds }`), o null. */
export function instantOf(value) {
  if (value == null) return null
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.seconds === 'number') return value.seconds * 1000 + Math.floor((value.nanoseconds ?? 0) / 1e6)
  if (typeof value._seconds === 'number') return value._seconds * 1000 + Math.floor((value._nanoseconds ?? 0) / 1e6)
  return null
}

/** Segundos y nanosegundos de un instante, con la precisión que tenga (un `Date`, al milisegundo), o null. */
function preciseOf(value) {
  if (value == null) return null
  if (typeof value.seconds === 'number') return [value.seconds, value.nanoseconds ?? 0]
  const ms = instantOf(value)
  return ms == null ? null : [Math.floor(ms / 1000), (ms - Math.floor(ms / 1000) * 1000) * 1e6]
}

/** Compara dos instantes al nanosegundo: negativo si `a` es anterior, 0 si son iguales, null si falta alguno. */
export function compareInstants(a, b) {
  const x = preciseOf(a)
  const y = preciseOf(b)
  if (!x || !y) return null
  return x[0] !== y[0] ? x[0] - y[0] : x[1] - y[1]
}

/** Día `YYYY-MM-DD` de un instante en la zona horaria dada, o null. */
export function localDay(value, timeZone = DEFAULT_TIME_ZONE) {
  const ms = instantOf(value)
  if (ms == null) return null
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(ms))
    .reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {})
  return `${parts.year}-${parts.month}-${parts.day}`
}

const isTime = v => v instanceof Date || (v != null && typeof v === 'object' && instantOf(v) != null)

/** Si dos valores de un campo son iguales: null y ausente cuentan igual, y los instantes se comparan por milisegundo. */
export function sameValue(a, b) {
  if (a == null || b == null) return a == null && b == null
  if (isTime(a) || isTime(b)) return instantOf(a) != null && instantOf(a) === instantOf(b)
  return a === b
}

/**
 * Campos que tienen que coincidir entre el documento viejo y su copia para dar la copia por buena (además del id).
 * Se eligen los que la app no edita: `carId` (no cambia nunca) y `createdAt` (lo copió la migración y nadie lo
 * reescribe). Los mantenimientos viejos no tienen `createdAt`: se compara el nombre. Si el documento viejo no tiene
 * `createdAt`, se comparan los campos del registro.
 */
export function fingerprintFields(collection, data) {
  const hasCreatedAt = instantOf(data?.createdAt) != null
  if (collection === 'cars') return hasCreatedAt ? ['createdAt'] : null
  if (collection === 'rules') return ['carId', 'name']
  if (collection === 'jobs') return hasCreatedAt ? ['carId', 'createdAt'] : ['carId', 'date', 'title']
  if (collection === 'fuel') return hasCreatedAt ? ['carId', 'createdAt'] : ['carId', 'date', 'total']
  return null
}

/** Campos de `fields` que no coinciden entre el documento viejo y su copia. */
function differences(fields, legacy, copy) {
  return fields.filter(f => !sameValue(legacy?.[f], copy?.[f]))
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const sourceOf = data => (typeof data?.source === 'string' ? data.source : 'manual')

/**
 * Busca la copia de cada lectura vieja de un auto en `cars/{carId}/odometer`. La migración copió cada lectura con el
 * mismo id; después `link-readings` movió las de cargas y trabajos a `{source}-{id}` (con `sourceId` y la fecha del
 * registro a las 12:00) y borró la de ese id. Las opciones de copia de cada lectura vieja son:
 *
 * 1. **Mismo id**: la lectura nueva con el id de la vieja, con el mismo `carId`, km y fecha. Si existe y es distinta,
 *    no tiene opciones (`copy-differs`).
 * 2. **`sourceId`** (si la vieja lo tiene): la lectura `{source}-{sourceId}` con el mismo km.
 * 3. **Mismo día**, sólo para una vieja de una carga o un trabajo (`source` `fuel` o `job`) sin copia con su id: las
 *    lecturas nuevas vinculadas (con `sourceId`) del mismo `source`, `carId` y km, y del mismo día local que la vieja,
 *    contando como su día el de su fecha o el del `createdAt` de su carga o su trabajo (la lectura vieja se grababa
 *    con la hora en que se guardaba el registro). Una lectura sin `sourceId` nunca es candidata: es la copia de la
 *    vieja con su mismo id, y cuando esa vieja ya se borró no habría cómo saberlo.
 *
 * Una vieja se da por copiada sólo si tiene una sola opción y esa lectura nueva no es opción de ninguna otra vieja del
 * auto. Si una lectura nueva le sirve a más de una, todas quedan (`ambiguous`), así la decisión no cambia de una
 * corrida a la siguiente: borrar una vieja copiada no le deja libre su copia a otra. Devuelve un Map de id viejo a
 * `{ copy, via }` o a `{ reason, detail }`.
 */
export function matchReadings({ legacy, current, records = {}, timeZone = DEFAULT_TIME_ZONE }) {
  const result = new Map()
  const options = new Map()
  const byId = new Map(current.map(r => [r.id, r]))
  const legacyIds = new Set(legacy.map(r => r.id))

  const daysOf = reading => {
    const days = new Set([localDay(reading.data.date, timeZone)])
    const collection = LINKED_COLLECTIONS[reading.data.source]
    const record = collection ? records[collection]?.get(reading.data.sourceId) : null
    if (record) days.add(localDay(record.createdAt, timeZone))
    days.delete(null)
    return days
  }

  for (const r of [...legacy].sort((a, b) => a.id.localeCompare(b.id))) {
    const same = byId.get(r.id)
    if (same) {
      const diff = differences(['carId', 'km', 'date'], r.data, same.data)
      if (diff.length) result.set(r.id, { reason: 'copy-differs', detail: diff.join(', ') })
      else options.set(r.id, { ids: [r.id], via: 'id' })
      continue
    }
    const source = sourceOf(r.data)
    const km = num(r.data.km)
    if (typeof r.data.sourceId === 'string' && LINKED_COLLECTIONS[source]) {
      const id = `${source}-${r.data.sourceId}`
      const copy = byId.get(id)
      if (copy && km != null && num(copy.data.km) === km) options.set(r.id, { ids: [id], via: 'sourceId' })
      else result.set(r.id, { reason: 'no-copy', detail: `no está ${id} con ${r.data.km} km` })
      continue
    }
    if (!LINKED_COLLECTIONS[source]) {
      result.set(r.id, { reason: 'no-copy', detail: `no existe la lectura ${r.id}` })
      continue
    }
    const day = localDay(r.data.date, timeZone)
    if (km == null || day == null) {
      result.set(r.id, { reason: 'no-fingerprint', detail: 'sin km o sin fecha' })
      continue
    }
    const ids = current
      .filter(c => !legacyIds.has(c.id) && typeof c.data.sourceId === 'string' && sourceOf(c.data) === source)
      .filter(c => num(c.data.km) === km && sameValue(c.data.carId, r.data.carId) && daysOf(c).has(day))
      .map(c => c.id)
      .sort()
    if (ids.length) options.set(r.id, { ids, via: 'day' })
    else result.set(r.id, { reason: 'no-copy', detail: `ninguna lectura vinculada de ${km} km del ${day}` })
  }

  const users = new Map()
  options.forEach(({ ids }, legacyId) => ids.forEach(id => users.set(id, [...(users.get(id) ?? []), legacyId])))

  options.forEach(({ ids, via }, legacyId) => {
    if (ids.length > 1) {
      result.set(legacyId, { reason: 'ambiguous', detail: ids.join(', ') })
      return
    }
    const shared = users.get(ids[0]).filter(id => id !== legacyId)
    if (shared.length) result.set(legacyId, { reason: 'ambiguous', detail: `${ids[0]} también le sirve a ${shared.sort().join(', ')}` })
    else result.set(legacyId, { copy: ids[0], via })
  })

  return result
}

/** Ids de autos a leer en `cars/` para una cuenta: los de sus autos viejos (los hijos de otro auto son huérfanos). */
export function referencedCarIds(legacy) {
  return [...new Set(legacy.cars.map(c => c.id))].filter(id => CAR_ID.test(id)).sort()
}

/** Si el auto nuevo es de la cuenta: es la dueña o está en `memberUids` (le pudo pasar el auto a un miembro). */
function belongsTo(car, uid) {
  return car.ownerUid === uid || (Array.isArray(car.memberUids) && car.memberUids.includes(uid))
}

/**
 * Decide qué documentos viejos de una cuenta se borran y cuáles quedan, a partir de lo que ya se leyó de Firestore.
 * No toca Firestore: lo corre `cleanup-legacy.mjs` y lo prueba vitest.
 *
 * `legacy` trae los documentos de `users/{uid}/{cars|rules|jobs|fuel|odometer}` como `{ id, data, updateTime }`, y
 * `legacyCarsWithChildren` los ids de autos viejos que tienen alguna subcolección (esos quedan: borrar el documento
 * dejaría sus hijos sueltos). `current` es un Map de id de auto a lo que hay en `cars/{carId}`: `{ car, rules, jobs,
 * fuel, odometer, createTimes }`, con `car` = los datos del auto o null, `rules`/`jobs`/`fuel` Maps de id a datos,
 * `odometer` una lista `{ id, data }` y `createTimes` un Map de ruta (`cars/…`) a su `createTime`.
 *
 * Un documento viejo se borra sólo si su copia está probada:
 * - un hijo tiene que ser de un auto viejo de la cuenta (si no, `orphan`);
 * - el auto `cars/{carId}` existe, no está marcado como borrado y es de la cuenta (dueña o en `memberUids`; si no,
 *   `conflict`);
 * - la copia existe con el mismo id y los mismos `fingerprintFields` (las lecturas de km, con `matchReadings`);
 * - el documento viejo no cambió después de que se creó la copia (`updateTime` viejo > `createTime` de la copia:
 *   `legacy-newer`, lo editó la versión vieja de la PWA después de migrar). Si falta alguno de los dos, no se compara.
 * Un auto viejo se borra sólo si además se borran todos sus hijos viejos. Todo lo demás queda, con el motivo.
 *
 * Devuelve `deletes` (primero los hijos y al final los autos, cada uno `{ path, collection, carId, data, copyPath,
 * carPath }`; un auto trae `children` con las rutas de sus hijos, que tienen que haberse borrado antes) y el `report`
 * de la cuenta: `{ uid, deleted: [{ path, carId, via }], kept: [{ path, carId, reason, detail }] }`.
 */
export function planAccountCleanup({ uid, legacy, legacyCarsWithChildren = new Set(), current, timeZone = DEFAULT_TIME_ZONE }) {
  const report = { uid, deleted: [], kept: [] }
  const deletes = []
  const keptCars = new Set()
  const childrenOf = new Map()
  const legacyCarIds = new Set(legacy.cars.map(c => c.id))

  const carProblem = carId => {
    const car = current.get(carId)?.car
    if (!car) return { reason: 'car-missing', detail: `no existe cars/${carId}` }
    if (car.deletedAt != null) return { reason: 'car-deleted', detail: `cars/${carId} está marcado como borrado` }
    if (!belongsTo(car, uid)) return { reason: 'conflict', detail: `cars/${carId} es de otra cuenta` }
    return null
  }
  const parentProblem = carId => {
    if (typeof carId !== 'string' || !CAR_ID.test(carId)) return { reason: 'no-car-id', detail: `carId ${JSON.stringify(carId ?? null)}` }
    if (!legacyCarIds.has(carId)) return { reason: 'orphan', detail: `${carId} no es un auto viejo de la cuenta` }
    return carProblem(carId)
  }
  const newer = (doc, copyPath, carId) => {
    const order = compareInstants(doc.updateTime, current.get(carId)?.createTimes?.get(copyPath))
    return order != null && order > 0
  }
  const keep = (path, carId, reason, detail = null) => {
    report.kept.push({ path, carId: carId ?? null, reason, detail })
    if (typeof carId === 'string') keptCars.add(carId)
  }
  const remove = (collection, doc, carId, copyPath, via) => {
    const path = legacyPath(uid, collection, doc.id)
    deletes.push({ path, collection, carId, data: doc.data, copyPath, carPath: `cars/${carId}` })
    report.deleted.push({ path, carId, via })
    if (!childrenOf.has(carId)) childrenOf.set(carId, [])
    childrenOf.get(carId).push(path)
  }

  for (const name of LEGACY_CHILDREN) {
    const docs = [...legacy[name]].sort((a, b) => a.id.localeCompare(b.id))
    const readingMatches = new Map()
    if (name === 'odometer') {
      const byCar = new Map()
      for (const r of docs) {
        if (parentProblem(r.data?.carId)) continue
        if (!byCar.has(r.data.carId)) byCar.set(r.data.carId, [])
        byCar.get(r.data.carId).push(r)
      }
      for (const [carId, readings] of byCar) {
        const target = current.get(carId)
        const matches = matchReadings({
          legacy: readings,
          current: target.odometer ?? [],
          records: { fuel: target.fuel ?? new Map(), jobs: target.jobs ?? new Map() },
          timeZone,
        })
        matches.forEach((m, id) => readingMatches.set(id, m))
      }
    }

    for (const doc of docs) {
      const path = legacyPath(uid, name, doc.id)
      const carId = doc.data?.carId
      const problem = parentProblem(carId)
      if (problem) {
        keep(path, carId, problem.reason, problem.detail)
        continue
      }
      let copyPath
      let via
      if (name === 'odometer') {
        const match = readingMatches.get(doc.id)
        if (!match?.copy) {
          keep(path, carId, match?.reason ?? 'no-copy', match?.detail ?? null)
          continue
        }
        copyPath = `cars/${carId}/odometer/${match.copy}`
        via = `${copyPath} (${match.via})`
      } else {
        copyPath = `cars/${carId}/${name}/${doc.id}`
        const copy = current.get(carId)[name]?.get(doc.id)
        if (!copy) {
          keep(path, carId, 'no-copy', `no existe ${copyPath}`)
          continue
        }
        const diff = differences(fingerprintFields(name, doc.data), doc.data, copy)
        if (diff.length) {
          keep(path, carId, 'copy-differs', diff.join(', '))
          continue
        }
        via = copyPath
      }
      if (newer(doc, copyPath, carId)) {
        keep(path, carId, 'legacy-newer', `cambió después de crearse ${copyPath}`)
        continue
      }
      remove(name, doc, carId, copyPath, via)
    }
  }

  for (const doc of [...legacy.cars].sort((a, b) => a.id.localeCompare(b.id))) {
    const path = legacyPath(uid, 'cars', doc.id)
    const copyPath = `cars/${doc.id}`
    if (!CAR_ID.test(doc.id)) {
      keep(path, null, 'no-car-id', `id ${JSON.stringify(doc.id)}`)
      continue
    }
    const problem = carProblem(doc.id)
    if (problem) {
      keep(path, doc.id, problem.reason, problem.detail)
      continue
    }
    if (keptCars.has(doc.id)) {
      keep(path, doc.id, 'child-kept', 'queda algún hijo viejo de este auto')
      continue
    }
    if (legacyCarsWithChildren.has(doc.id)) {
      keep(path, doc.id, 'has-subcollections', 'el documento viejo tiene subcolecciones')
      continue
    }
    const fields = fingerprintFields('cars', doc.data)
    if (!fields) {
      keep(path, doc.id, 'no-fingerprint', 'el auto viejo no tiene createdAt')
      continue
    }
    const diff = differences(fields, doc.data, current.get(doc.id).car)
    if (diff.length) {
      keep(path, doc.id, 'copy-differs', diff.join(', '))
      continue
    }
    if (newer(doc, copyPath, doc.id)) {
      keep(path, doc.id, 'legacy-newer', `cambió después de crearse ${copyPath}`)
      continue
    }
    deletes.push({ path, collection: 'cars', carId: doc.id, data: doc.data, copyPath, carPath: copyPath, children: childrenOf.get(doc.id) ?? [] })
    report.deleted.push({ path, carId: doc.id, via: copyPath })
  }

  return { deletes, report }
}

/**
 * Vuelve a mirar, justo antes de borrar, que nada cambió desde que se decidió: el documento viejo, su copia y el auto
 * nuevo tienen que existir con el mismo `updateTime` que cuando se leyeron. `expected` y `fresh` traen `legacy`,
 * `copy` y `car`; en `fresh`, cada uno es `{ exists, updateTime }`. Devuelve null si se puede borrar o el motivo.
 */
export function recheck({ expected, fresh }) {
  for (const key of ['legacy', 'copy', 'car']) {
    const now = fresh[key]
    if (!now?.exists) return `${key}: ya no existe`
    if (expected[key] == null || compareInstants(expected[key], now.updateTime) !== 0) return `${key}: cambió desde que se leyó`
  }
  return null
}

/**
 * Pasa los datos de un documento a algo que JSON guarda sin perder información: los instantes como
 * `{ __time: ISO, seconds, nanoseconds }`, las referencias como `{ __ref: ruta }`, los bytes en base64 y los
 * GeoPoint como `{ __geo: [lat, lng] }`. Tira error con un número no finito (JSON lo guardaría como null).
 */
export function toBackupValue(value) {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`número no finito: ${value}`)
  if (value == null || typeof value !== 'object') return value ?? null
  if (Array.isArray(value)) return value.map(toBackupValue)
  if (value instanceof Date) {
    return { __time: value.toISOString(), seconds: Math.floor(value.getTime() / 1000), nanoseconds: (value.getTime() % 1000) * 1e6 }
  }
  if (typeof value.toDate === 'function' && typeof value.seconds === 'number') {
    return { __time: value.toDate().toISOString(), seconds: value.seconds, nanoseconds: value.nanoseconds ?? 0 }
  }
  if (typeof value.path === 'string' && typeof value.id === 'string' && value.firestore) return { __ref: value.path }
  if (typeof value.latitude === 'number' && typeof value.longitude === 'number') return { __geo: [value.latitude, value.longitude] }
  if (value instanceof Uint8Array) return { __bytes: Buffer.from(value).toString('base64') }
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toBackupValue(v)]))
}

/** Contenido del archivo de respaldo: la fecha y cada documento que se va a borrar, con su ruta y sus datos. */
export function buildBackup(deletes, now = new Date()) {
  return {
    createdAt: now.toISOString(),
    count: deletes.length,
    docs: deletes.map(d => {
      try {
        return { path: d.path, data: toBackupValue(d.data) }
      } catch (e) {
        throw new Error(`${d.path}: ${e.message}`)
      }
    }),
  }
}

/** Si dos valores ya pasados por JSON son iguales, campo por campo y en el mismo orden de las listas. */
function deepEqual(a, b) {
  if (a === b) return true
  if (a == null || b == null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  const kb = Object.keys(b)
  return ka.length === kb.length && ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]))
}

/**
 * Verifica el respaldo releído del disco contra lo que se va a borrar: que sea JSON, que tenga un documento por cada
 * borrado, en el mismo orden, con la misma ruta y los mismos datos. Devuelve null si coincide o el motivo.
 */
export function verifyBackup(text, deletes) {
  let read
  try {
    read = JSON.parse(text)
  } catch {
    return 'el respaldo no es JSON válido'
  }
  if (read?.count !== deletes.length || !Array.isArray(read.docs) || read.docs.length !== deletes.length) {
    return 'el respaldo no tiene la misma cantidad de documentos'
  }
  for (let i = 0; i < deletes.length; i++) {
    const doc = read.docs[i]
    if (doc?.path !== deletes[i].path) return `el documento ${i + 1} del respaldo no es ${deletes[i].path}`
    if (!deepEqual(doc.data, toBackupValue(deletes[i].data))) return `los datos de ${deletes[i].path} no coinciden`
  }
  return null
}

/** Nombre del archivo de respaldo: `legacy-backup-<fecha y hora UTC>.json`, sin caracteres que Windows no acepta. */
export function backupFileName(now = new Date()) {
  return `legacy-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

/** Textos de cada motivo por el que un documento viejo queda. */
export const KEEP_REASONS = {
  'no-car-id': 'sin un carId válido',
  orphan: 'no es de un auto viejo de la cuenta',
  'car-missing': 'el auto no existe en cars/',
  'car-deleted': 'el auto está marcado como borrado en cars/',
  conflict: 'el auto de cars/ es de otra cuenta',
  'no-copy': 'sin copia en cars/',
  'copy-differs': 'la copia es distinta',
  ambiguous: 'más de una copia posible',
  'no-fingerprint': 'sin datos para comparar con la copia',
  'legacy-newer': 'el documento viejo cambió después de copiarse',
  'child-kept': 'queda algún hijo',
  'has-subcollections': 'tiene subcolecciones',
}
