/** Origen de una lectura que nace de otro registro y la colección de ese registro: `job` ≠ `jobs`. */
export const LINKED_COLLECTIONS = { fuel: 'fuel', job: 'jobs' }

/** Id de la lectura de una carga o un trabajo. Tiene que dar lo mismo que `linkedReadingId` de lib/odometer.ts. */
export const linkedReadingId = (source, sourceId) => `${source}-${sourceId}`

/** Mediodía local del día del registro. Tiene que dar lo mismo que `readingDateOf` de lib/odometer.ts. */
export const readingDateOf = date => new Date(`${date}T12:00:00`)

/** Id de la lectura que deja `currentKm` como el máximo de las lecturas de un auto viejo. */
export const baselineReadingId = carId => `baseline-${carId}`

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Un trabajo sin estado (guardado antes de compartir autos) cuenta como aprobado, como en lib/db.ts. */
const isApproved = job => job.data.status !== 'pending' && job.data.status !== 'rejected'

/**
 * Decide qué escribir en un auto para vincular sus lecturas de km con las cargas y los trabajos, a partir de lo que
 * ya se leyó de Firestore. No toca Firestore: lo corre `link-readings.mjs` y lo prueba vitest.
 *
 * `car`, y cada elemento de `readings`, `fuel` y `jobs`, vienen como `{ id, data }`. `now` es la fecha de la
 * lectura baseline si el auto no tiene ni `kmUpdatedAt` ni `createdAt`.
 *
 * a. Si el auto no tiene lecturas o su `currentKm` es mayor que la más alta, crea `baseline-{carId}` con
 *    `source: 'initial'`, `km = currentKm`, la fecha `kmUpdatedAt ?? createdAt` y a nombre del dueño. Desde ahí la
 *    lectura más alta es el km del auto, y la app puede recalcularlo desde las lecturas sin que baje.
 * b. Vincula las lecturas viejas con `source` 'fuel' o 'job' y sin `sourceId`. Los candidatos son las cargas o los
 *    trabajos aprobados del auto con el mismo km y todavía sin lectura vinculada. Con uno solo, copia la lectura a
 *    `{source}-{id}` con `sourceId`, la fecha del registro (12:00) y el autor del registro, y borra la vieja. Con
 *    0 o más de 1, la deja como está y la informa (`unmatched` o `ambiguous`).
 * c. Las cargas y los trabajos aprobados con km y sin lectura vinculada reciben la suya.
 *
 * Devuelve `groups` (cada grupo se escribe en un mismo batch: la lectura nueva y el borrado de la vieja van juntos)
 * con `{ op: 'set' | 'delete', path, data? }`, y el `report` del auto. Si ya se corrió, no devuelve nada para
 * escribir.
 */
export function planCarLinks({ car, readings, fuel, jobs, now = new Date() }) {
  const carId = car.id
  const ownerUid = car.data.ownerUid ?? null
  const ownerName = car.data.ownerName ?? null
  const groups = []
  const report = { carId, baseline: 0, linked: 0, completed: 0, ambiguous: [], unmatched: [] }
  const odometerPath = id => `cars/${carId}/odometer/${id}`
  const existing = new Set(readings.map(r => r.id))

  const currentKm = num(car.data.currentKm) ?? 0
  const top = readings.reduce((max, r) => Math.max(max, num(r.data.km) ?? -Infinity), -Infinity)
  if (currentKm > top) {
    groups.push([
      {
        op: 'set',
        path: odometerPath(baselineReadingId(carId)),
        data: {
          carId,
          km: currentKm,
          date: car.data.kmUpdatedAt ?? car.data.createdAt ?? now,
          source: 'initial',
          sourceId: null,
          createdBy: ownerUid,
          createdByName: ownerName,
        },
      },
    ])
    report.baseline++
  }

  const records = [
    ...fuel.map(rec => ({ source: 'fuel', rec })),
    ...jobs.filter(isApproved).map(rec => ({ source: 'job', rec })),
  ].filter(x => num(x.rec.data.km) != null && typeof x.rec.data.date === 'string')
  const claimed = new Set()
  const idOf = x => linkedReadingId(x.source, x.rec.id)
  const isLinked = x => existing.has(idOf(x)) || claimed.has(idOf(x))
  const linkedWrite = x => ({
    op: 'set',
    path: odometerPath(idOf(x)),
    data: {
      carId,
      km: x.rec.data.km,
      date: readingDateOf(x.rec.data.date),
      source: x.source,
      sourceId: x.rec.id,
      ...(x.rec.data.createdBy
        ? { createdBy: x.rec.data.createdBy, createdByName: x.rec.data.createdByName ?? null }
        : { createdBy: ownerUid, createdByName: ownerName }),
    },
  })

  const unlinked = readings
    .filter(r => (r.data.source === 'fuel' || r.data.source === 'job') && !r.data.sourceId)
    .sort((a, b) => a.id.localeCompare(b.id))
  for (const r of unlinked) {
    const km = num(r.data.km)
    const candidates = records.filter(x => x.source === r.data.source && x.rec.data.km === km && !isLinked(x))
    if (candidates.length !== 1) {
      const list = candidates.length ? report.ambiguous : report.unmatched
      list.push({ path: odometerPath(r.id), source: r.data.source, km, candidates: candidates.map(x => x.rec.id) })
      continue
    }
    const [x] = candidates
    claimed.add(idOf(x))
    groups.push([linkedWrite(x), { op: 'delete', path: odometerPath(r.id) }])
    report.linked++
  }

  for (const x of records) {
    if (isLinked(x)) continue
    claimed.add(idOf(x))
    groups.push([linkedWrite(x)])
    report.completed++
  }

  return { groups, report }
}

/** Arma tandas de como mucho `size` escrituras sin partir un grupo: un batch de Firestore admite hasta 500. */
export function packGroups(groups, size = 450) {
  const batches = []
  let current = []
  for (const group of groups) {
    if (current.length && current.length + group.length > size) {
      batches.push(current)
      current = []
    }
    current = current.concat(group)
  }
  if (current.length) batches.push(current)
  return batches
}
