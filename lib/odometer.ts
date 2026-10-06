import { daysBetweenInstants, toISODate } from './dates'
import { formatDate } from './format'
import type { ISODate } from './types'

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
