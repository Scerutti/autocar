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
 * Busca la copia de cada lectura vieja de un auto en `cars/{carId}/odometer`. La copia puede tener otro id: la
 * migración la copió con el mismo id, pero `link-readings` movió las de cargas y trabajos a `{source}-{id}` (con la
 * fecha del registro a las 12:00) y borró la de ese id. En este orden:
 *
 * 1. **Mismo id**: la lectura nueva con el id de la vieja, con el mismo km y la misma fecha. Si existe y es distinta,
 *    no se busca otra: queda (`copy-differs`).
 * 2. **`sourceId`** (si la vieja lo tiene): la lectura `{source}-{sourceId}` con el mismo km. Si no está, queda.
 * 3. **Mismo día**: las lecturas nuevas del mismo km, del mismo `source` (sin `source` = `manual`) y del mismo día
 *    local que la vieja, contando como su día el de su fecha o, en una vinculada, el del `createdAt` de su carga o
 *    su trabajo (la lectura vieja se grababa con la hora en que se guardaba el registro). Tiene que haber una sola:
 *    con ninguna queda (`no-copy`) y con más de una también (`ambiguous`).
 *
 * Cada lectura nueva es la copia de una sola vieja, y una con el id de una vieja sólo puede ser la copia de esa.
 * Devuelve un Map de id viejo a `{ copy, via }` o a `{ reason, detail }`.
 */
export function matchReadings({ legacy, current, records = {}, timeZone = DEFAULT_TIME_ZONE }) {
  const result = new Map()
  const byId = new Map(current.map(r => [r.id, r]))
  const reserved = new Set(legacy.filter(r => byId.has(r.id)).map(r => r.id))
  const claimed = new Set()
  const ordered = [...legacy].sort((a, b) => a.id.localeCompare(b.id))

  for (const r of ordered) {
    const copy = byId.get(r.id)
    if (!copy) continue
    const diff = differences(['carId', 'km', 'date'], r.data, copy.data)
    if (diff.length) {
      result.set(r.id, { reason: 'copy-differs', detail: diff.join(', ') })
      continue
    }
    claimed.add(copy.id)
    result.set(r.id, { copy: copy.id, via: 'id' })
  }

  for (const r of ordered) {
    if (result.has(r.id) || typeof r.data.sourceId !== 'string' || !LINKED_COLLECTIONS[r.data.source]) continue
    const id = `${r.data.source}-${r.data.sourceId}`
    const copy = byId.get(id)
    if (copy && !claimed.has(id) && !reserved.has(id) && num(copy.data.km) != null && num(copy.data.km) === num(r.data.km)) {
      claimed.add(id)
      result.set(r.id, { copy: id, via: 'sourceId' })
    } else {
      result.set(r.id, { reason: 'no-copy', detail: `no está ${id} con ${r.data.km} km` })
    }
  }

  const daysOf = reading => {
    const days = new Set([localDay(reading.data.date, timeZone)])
    const collection = LINKED_COLLECTIONS[reading.data.source]
    const record = collection && typeof reading.data.sourceId === 'string' ? records[collection]?.get(reading.data.sourceId) : null
    if (record) days.add(localDay(record.createdAt, timeZone))
    days.delete(null)
    return days
  }

  for (const r of ordered) {
    if (result.has(r.id)) continue
    const km = num(r.data.km)
    const day = localDay(r.data.date, timeZone)
    if (km == null || day == null) {
      result.set(r.id, { reason: 'no-fingerprint', detail: 'sin km o sin fecha' })
      continue
    }
    const candidates = current
      .filter(c => !reserved.has(c.id) && !claimed.has(c.id))
      .filter(c => num(c.data.km) === km && sourceOf(c.data) === sourceOf(r.data) && sameValue(c.data.carId, r.data.carId))
      .filter(c => daysOf(c).has(day))
      .map(c => c.id)
      .sort()
    if (candidates.length === 1) {
      claimed.add(candidates[0])
      result.set(r.id, { copy: candidates[0], via: 'day' })
    } else if (candidates.length) {
      result.set(r.id, { reason: 'ambiguous', detail: candidates.join(', ') })
    } else {
      result.set(r.id, { reason: 'no-copy', detail: `ninguna lectura de ${km} km del ${day}` })
    }
  }

  return result
}

/** Ids de autos a leer en `cars/` para una cuenta: los de sus autos viejos y los `carId` de sus hijos viejos. */
export function referencedCarIds(legacy) {
  const ids = new Set(legacy.cars.map(c => c.id))
  for (const name of LEGACY_CHILDREN) {
    for (const child of legacy[name]) if (typeof child.data?.carId === 'string') ids.add(child.data.carId)
  }
  return [...ids].filter(id => CAR_ID.test(id)).sort()
}

/** Por qué no se puede usar `cars/{carId}` como prueba de una copia, o null si se puede. */
function carProblem(carId, current) {
  if (typeof carId !== 'string' || !CAR_ID.test(carId)) return { reason: 'no-car-id', detail: `carId ${JSON.stringify(carId ?? null)}` }
  const car = current.get(carId)?.car
  if (!car) return { reason: 'car-missing', detail: `no existe cars/${carId}` }
  if (car.deletedAt != null) return { reason: 'car-deleted', detail: `cars/${carId} está marcado como borrado` }
  return null
}

/**
 * Decide qué documentos viejos de una cuenta se borran y cuáles quedan, a partir de lo que ya se leyó de Firestore.
 * No toca Firestore: lo corre `cleanup-legacy.mjs` y lo prueba vitest.
 *
 * `legacy` trae los documentos de `users/{uid}/{cars|rules|jobs|fuel|odometer}` como `{ id, data }`, y
 * `legacyCarsWithChildren` los ids de autos viejos que tienen alguna subcolección (esos quedan: borrar el documento
 * dejaría sus hijos sueltos). `current` es un Map de id de auto a lo que hay en `cars/{carId}`: `{ car, rules, jobs,
 * fuel, odometer }`, con `car` = los datos del auto o null, `rules`/`jobs`/`fuel` Maps de id a datos y `odometer`
 * una lista `{ id, data }`.
 *
 * Un documento viejo se borra sólo si su copia está probada: el auto `cars/{carId}` existe y no está marcado como
 * borrado, y la copia existe con el mismo id y los mismos `fingerprintFields` (las lecturas de km, con
 * `matchReadings`). Un auto viejo se borra sólo si además se borran todos sus hijos viejos (los que tienen su
 * `carId`). Todo lo demás queda, con el motivo.
 *
 * Devuelve `deletes` (primero los hijos y al final los autos, cada uno `{ path, collection, carId, data }`; un auto
 * trae `children` con las rutas de sus hijos, que tienen que haberse borrado antes) y el `report` de la cuenta:
 * `{ uid, deleted: [{ path, carId, via }], kept: [{ path, carId, reason, detail }] }`.
 */
export function planAccountCleanup({ uid, legacy, legacyCarsWithChildren = new Set(), current, timeZone = DEFAULT_TIME_ZONE }) {
  const report = { uid, deleted: [], kept: [] }
  const deletes = []
  const keptCars = new Set()
  const childrenOf = new Map()

  const keep = (path, carId, reason, detail = null) => {
    report.kept.push({ path, carId: carId ?? null, reason, detail })
    if (typeof carId === 'string') keptCars.add(carId)
  }
  const remove = (collection, doc, carId, via) => {
    const path = legacyPath(uid, collection, doc.id)
    deletes.push({ path, collection, carId, data: doc.data })
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
        if (typeof r.data?.carId !== 'string' || carProblem(r.data.carId, current)) continue
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
      const problem = carProblem(carId, current)
      if (problem) {
        keep(path, carId, problem.reason, problem.detail)
        continue
      }
      if (name === 'odometer') {
        const match = readingMatches.get(doc.id)
        if (match?.copy) remove(name, doc, carId, `cars/${carId}/odometer/${match.copy} (${match.via})`)
        else keep(path, carId, match?.reason ?? 'no-copy', match?.detail ?? null)
        continue
      }
      const copy = current.get(carId)[name]?.get(doc.id)
      if (!copy) {
        keep(path, carId, 'no-copy', `no existe cars/${carId}/${name}/${doc.id}`)
        continue
      }
      const diff = differences(fingerprintFields(name, doc.data), doc.data, copy)
      if (diff.length) {
        keep(path, carId, 'copy-differs', diff.join(', '))
        continue
      }
      remove(name, doc, carId, `cars/${carId}/${name}/${doc.id}`)
    }
  }

  for (const doc of [...legacy.cars].sort((a, b) => a.id.localeCompare(b.id))) {
    const path = legacyPath(uid, 'cars', doc.id)
    const problem = carProblem(doc.id, current)
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
    deletes.push({ path, collection: 'cars', carId: doc.id, data: doc.data, children: childrenOf.get(doc.id) ?? [] })
    report.deleted.push({ path, carId: doc.id, via: `cars/${doc.id}` })
  }

  return { deletes, report }
}

/**
 * Pasa los datos de un documento a algo que JSON guarda sin perder información: los instantes como
 * `{ __time: ISO, seconds, nanoseconds }`, las referencias como `{ __ref: ruta }`, los bytes en base64 y los
 * GeoPoint como `{ __geo: [lat, lng] }`.
 */
export function toBackupValue(value) {
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
    docs: deletes.map(d => ({ path: d.path, data: toBackupValue(d.data) })),
  }
}

/** Nombre del archivo de respaldo: `legacy-backup-<fecha y hora UTC>.json`, sin caracteres que Windows no acepta. */
export function backupFileName(now = new Date()) {
  return `legacy-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`
}

/** Textos de cada motivo por el que un documento viejo queda. */
export const KEEP_REASONS = {
  'no-car-id': 'sin un carId válido',
  'car-missing': 'el auto no existe en cars/',
  'car-deleted': 'el auto está marcado como borrado en cars/',
  'no-copy': 'sin copia en cars/',
  'copy-differs': 'la copia es distinta',
  ambiguous: 'más de una copia posible',
  'no-fingerprint': 'sin datos para comparar con la copia',
  'child-kept': 'queda algún hijo',
  'has-subcollections': 'tiene subcolecciones',
}
