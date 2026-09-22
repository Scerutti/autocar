import { daysBetweenInstants } from './dates'

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
  if (newKm - currentKm > SUSPICIOUS_JUMP_KM) {
    return {
      ok: true,
      warning: `Son ${(newKm - currentKm).toLocaleString('es-AR')} km más que el último registro. ¿Seguro?`,
    }
  }
  return { ok: true }
}
