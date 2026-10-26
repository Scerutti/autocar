import { daysBetween, daysBetweenInstants, toISODate } from './dates'
import { formatDate, formatDayMonth, formatKm } from './format'
import type { FuelLoad, ISODate, Job, OdometerReading, OdometerSource } from './types'

const WINDOW_DAYS = 120
const MIN_SPAN_DAYS = 3
const SUSPICIOUS_JUMP_KM = 20_000

/**
 * Km promedio por día a partir de las lecturas. Usa las de los últimos 120 días
 * (más la última anterior a esa ventana como punto de partida) para reflejar el uso reciente.
 */
export function computeAvgKmPerDay(readings: { km: number; date: Date }[], now = new Date()): number | null {
  const sorted = [...readings].sort((a, b) => a.date.getTime() - b.date.getTime())
  if (sorted.length < 2) return null
  const windowStart = now.getTime() - WINDOW_DAYS * 86_400_000
  let firstIdx = sorted.findIndex(r => r.date.getTime() >= windowStart)
  if (firstIdx === -1) firstIdx = sorted.length - 1
  if (firstIdx > 0) firstIdx -= 1
  const first = sorted[firstIdx]
  const last = sorted[sorted.length - 1]
  const span = daysBetweenInstants(first.date, last.date)
  if (span < MIN_SPAN_DAYS) return null
  const avg = (last.km - first.km) / span
  return avg > 0 ? Math.round(avg * 10) / 10 : null
}

/**
 * La lectura que define el km actual del auto: la de más km. Si hay empate, la más reciente.
 * null si no tiene lecturas.
 */
export function topReading<T extends { km: number; date: Date }>(readings: readonly T[]): T | null {
  let top: T | null = null
  for (const r of readings) {
    if (!top || r.km > top.km || (r.km === top.km && r.date.getTime() > top.date.getTime())) top = r
  }
  return top
}

/** Km del auto a partir de sus lecturas (de un solo auto): la más alta manda. Sin lecturas, 0 y sin fecha. */
export function carKmFrom(readings: { km: number; date: Date }[], now = new Date()) {
  const top = topReading(readings)
  return {
    currentKm: top?.km ?? 0,
    kmUpdatedAt: top?.date ?? null,
    avgKmPerDay: computeAvgKmPerDay(readings, now),
  }
}

/**
 * Qué escribir en el auto para que su km sea el de sus lecturas (las de ese auto): `carKmFrom(readings)` si el
 * `currentKm` guardado no es el de la lectura más alta, sea mayor o menor. null si ya coincide o si no hay lecturas
 * (sin lecturas no hay con qué corregir).
 */
export function kmCorrection(car: { currentKm: number }, readings: { km: number; date: Date }[], now = new Date()) {
  const top = topReading(readings)
  if (!top || top.km === car.currentKm) return null
  return carKmFrom(readings, now)
}

/**
 * El auto con el km que usan los avisos del cron: el de su lectura más alta (`top`, la primera de las lecturas
 * ordenadas por km de mayor a menor), aunque el `currentKm` guardado sea mayor o menor; `kmUpdatedAt` pasa a ser la
 * fecha de esa lectura. Sin lecturas, el auto tal cual. `avgKmPerDay` sigue saliendo del auto: es un estimado y no
 * amerita leer toda la serie. Con un empate de km Firestore devuelve cualquiera de las lecturas: el km es el mismo y
 * los avisos no miran la fecha.
 */
export function carKmForNotifications<C extends { currentKm: number; kmUpdatedAt: Date | null }>(
  car: C,
  top: { km: number; date: Date | null } | null,
): C {
  return top ? { ...car, currentKm: top.km, kmUpdatedAt: top.date } : car
}

/** Registros que dejan una lectura de km vinculada: una carga o un trabajo. */
export type LinkedSource = Extract<OdometerSource, 'fuel' | 'job'>

/** Id de la lectura que nace de una carga o un trabajo: uno por registro, así reintentar o editar la pisa en vez de duplicarla. */
export const linkedReadingId = (source: LinkedSource, sourceId: string) => `${source}-${sourceId}`

/** Mediodía local del día del registro: la lectura queda en su fecha sin que el huso la corra al día anterior. */
export const readingDateOf = (date: ISODate) => new Date(`${date}T12:00:00`)

/**
 * Las lecturas después de poner, cambiar (`next`) o sacar (`null`) la lectura `id`, para recalcular el km del
 * auto en el mismo batch. No modifica la lista recibida.
 */
export function withLinkedReading<T extends { id: string }>(readings: readonly T[], id: string, next: T | null): T[] {
  const rest = readings.filter(r => r.id !== id)
  return next ? [...rest, next] : rest
}

/**
 * De dónde salió una lectura vinculada, para la pestaña Km: la carga ("Carga del 12/03") o el trabajo
 * ("Trabajo: Service") que la generó y la ruta para abrirlo. null si la lectura no está vinculada o si el
 * registro no está entre los que tiene la app (se muestra el texto genérico del origen).
 */
export function readingOrigin(
  reading: Pick<OdometerReading, 'carId' | 'source' | 'sourceId'>,
  fuel: readonly Pick<FuelLoad, 'id' | 'carId' | 'date'>[],
  jobs: readonly Pick<Job, 'id' | 'carId' | 'title'>[],
): { label: string; href: string } | null {
  const { carId, source, sourceId } = reading
  if (!sourceId) return null
  if (source === 'fuel') {
    const load = fuel.find(f => f.id === sourceId && f.carId === carId)
    return load ? { label: `Carga del ${formatDayMonth(load.date)}`, href: `/autos/${carId}/combustible/${load.id}` } : null
  }
  if (source === 'job') {
    const job = jobs.find(j => j.id === sourceId && j.carId === carId)
    return job ? { label: `Trabajo: ${job.title}`, href: `/autos/${carId}/trabajos/${job.id}` } : null
  }
  return null
}

/** Una lectura de km con su fecha: lo único que miran los cálculos de la serie. */
type DatedKm = { km: number; date: Date }

/**
 * Las lecturas que acotan el km de una fecha, comparando por día local (las manuales guardan la hora en que se
 * cargaron y las vinculadas el mediodía):
 * - `before`: la de más km entre las de ese día o anteriores (empate: la más reciente). El km de esa fecha no puede
 *   ser menor.
 * - `after`: la de menos km entre las de días posteriores (empate: la más vieja). El km de esa fecha no puede ser
 *   mayor.
 * En una serie que sube con las fechas son la lectura anterior y la posterior. No importa el orden de la lista.
 */
export function neighborsAt<T extends DatedKm>(readings: readonly T[], date: ISODate): { before: T | null; after: T | null } {
  let before: T | null = null
  let after: T | null = null
  for (const r of readings) {
    if (toISODate(r.date) <= date) {
      if (!before || r.km > before.km || (r.km === before.km && r.date.getTime() > before.date.getTime())) before = r
    } else if (!after || r.km < after.km || (r.km === after.km && r.date.getTime() < after.date.getTime())) {
      after = r
    }
  }
  return { before, after }
}

/**
 * Km del auto en una fecha según sus lecturas (de un solo auto), comparando por día local:
 * - si hay lecturas de ese día, la de más km (`estimated: false`);
 * - entre dos lecturas (`neighborsAt`), la interpolación lineal por días, redondeada (`estimated: true`). Si la
 *   posterior tiene menos km que la anterior (una serie que no cierra), el km de la anterior: es la cota baja y
 *   avisa antes. Nunca da menos que la anterior;
 * - después de la última, el km de la última (`estimated: true`): también es una cota baja;
 * - antes de la primera, o sin lecturas, null.
 */
export function kmAtDate(readings: readonly DatedKm[], date: ISODate): { km: number; estimated: boolean } | null {
  const sameDay = readings.filter(r => toISODate(r.date) === date)
  if (sameDay.length) return { km: Math.max(...sameDay.map(r => r.km)), estimated: false }
  const { before, after } = neighborsAt(readings, date)
  if (!before) return null
  if (!after || after.km <= before.km) return { km: before.km, estimated: true }
  const from = toISODate(before.date)
  const km = before.km + ((after.km - before.km) * daysBetween(from, date)) / daysBetween(from, toISODate(after.date))
  return { km: Math.max(before.km, Math.round(km)), estimated: true }
}

export type KmValidation = { ok: true; warning?: string } | { ok: false; error: string }

/**
 * Valida un km cargado a mano para una fecha contra las lecturas del auto (de ese auto, `neighborsAt`): no puede
 * ser menor que el más alto de ese día o de antes, ni mayor que el más bajo de los días posteriores. El mismo km
 * que la vecina se acepta. Con la fecha de hoy es lo de siempre: no menos que el km actual. Avisa (sin bloquear)
 * un salto muy grande sobre la lectura anterior.
 */
export function validateKmReading(newKm: number, date: ISODate, readings: readonly DatedKm[]): KmValidation {
  if (!Number.isFinite(newKm) || newKm < 0 || !Number.isInteger(newKm)) {
    return { ok: false, error: 'Ingresá un número entero de km.' }
  }
  const { before, after } = neighborsAt(readings, date)
  if (before && newKm < before.km) {
    return { ok: false, error: `El ${formatDate(toISODate(before.date))} ya tenía ${formatKm(before.km)}: no puede ser menos.` }
  }
  if (after && newKm > after.km) {
    return { ok: false, error: `El ${formatDate(toISODate(after.date))} tenía ${formatKm(after.km)}: no puede ser más.` }
  }
  const warning = before ? jumpWarning(newKm, before.km) : null
  return warning ? { ok: true, warning } : { ok: true }
}

function jumpWarning(newKm: number, currentKm: number) {
  if (newKm - currentKm <= SUSPICIOUS_JUMP_KM) return null
  return `Son ${(newKm - currentKm).toLocaleString('es-AR')} km más que el último registro. ¿Seguro?`
}

/**
 * Avisos (no bloquean) para los km de una carga o un trabajo, que suben el km del auto sin pasar
 * por la validación del registro de km:
 * - muchos km más que el último registro: suele ser un cero de más;
 * - en uno nuevo con fecha anterior al último registro, justo los km de ese registro (los que el
 *   formulario completa solo): ese día seguramente tenía menos, y con esos km se calcula cuándo toca
 *   el próximo mantenimiento;
 * - km que no entran en la serie de lecturas del auto (`readings`, de ese auto) por la fecha: menos que una
 *   lectura de ese día o anterior, o más que una posterior (`neighborsAt`). Al editar, `readingId` es la lectura del
 *   propio registro (`fuel-{id}` o `job-{id}`), que no cuenta.
 */
export function entryKmWarning(
  entry: { date: ISODate; km: number | null; isNew: boolean; readingId?: string | null },
  car: { currentKm: number; kmUpdatedAt: Date | null },
  readings: readonly (DatedKm & { id: string })[],
): string | null {
  if (entry.km == null) return null
  const jump = jumpWarning(entry.km, car.currentKm)
  if (jump) return `${jump} Fijate que no te sobre un cero.`
  if (entry.isNew && car.kmUpdatedAt && entry.km === car.currentKm) {
    const lastDate = toISODate(car.kmUpdatedAt)
    if (entry.date < lastDate) {
      return `Son los km del último registro (${formatDate(lastDate)}) y la fecha es anterior. Si ese día el auto tenía menos km, corregilos.`
    }
  }
  const { before, after } = neighborsAt(readings.filter(r => r.id !== entry.readingId), entry.date)
  if (before && entry.km < before.km) {
    return `El ${formatDate(toISODate(before.date))} el auto ya tenía ${formatKm(before.km)}, más que estos km. Revisá la fecha y los km.`
  }
  if (after && entry.km > after.km) {
    return `El ${formatDate(toISODate(after.date))} el auto tenía ${formatKm(after.km)}, menos que estos km. Revisá la fecha y los km.`
  }
  return null
}
