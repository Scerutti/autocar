import type { FuelType, IntervalUnit, NaftaGrade, TimeInterval } from './types'

// Lectura tolerante de documentos de Firestore, compartida por el cliente y el cron.

const UNITS: IntervalUnit[] = ['day', 'week', 'month', 'year']

/** Intervalo de tiempo de un mantenimiento (acepta el formato viejo `intervalMonths`). */
export function intervalFromDoc(x: Record<string, unknown>): TimeInterval | null {
  const t = x.intervalTime as { amount?: unknown; unit?: unknown } | null | undefined
  if (t && typeof t.amount === 'number' && t.amount > 0 && UNITS.includes(t.unit as IntervalUnit)) {
    return { amount: t.amount, unit: t.unit as IntervalUnit }
  }
  if (typeof x.intervalMonths === 'number' && x.intervalMonths > 0) return { amount: x.intervalMonths, unit: 'month' }
  return null
}

/** Combustibles de un auto: nafta, o nafta + GNC. Un "sólo GNC" viejo pasa a nafta + GNC. */
export function fuelTypesFromDoc(v: unknown): FuelType[] {
  return Array.isArray(v) && v.includes('gnc') ? ['nafta', 'gnc'] : ['nafta']
}

export function gradeFromDoc(v: unknown): NaftaGrade | null {
  return v === 'super' || v === 'premium' ? v : null
}
