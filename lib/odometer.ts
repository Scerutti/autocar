import { daysBetweenInstants, toISODate } from './dates'
import { formatDate, formatDayMonth } from './format'
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

export type KmValidation = { ok: true; warning?: string } | { ok: false; error: string }

export function validateKmReading(newKm: number, currentKm: number): KmValidation {
  if (!Number.isFinite(newKm) || newKm < 0 || !Number.isInteger(newKm)) {
    return { ok: false, error: 'Ingresá un número entero de km.' }
  }
  if (newKm < currentKm) {
    return { ok: false, error: `No puede ser menor al último registro (${currentKm.toLocaleString('es-AR')} km).` }
  }
  const warning = jumpWarning(newKm, currentKm)
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
 *   el próximo mantenimiento.
 */
export function entryKmWarning(
  entry: { date: ISODate; km: number | null; isNew: boolean },
  car: { currentKm: number; kmUpdatedAt: Date | null },
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
  return null
}
