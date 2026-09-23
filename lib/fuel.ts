import { FUEL_GRADE_LABELS, FUEL_LABELS, isLiquidFuel, type FuelGrade, type FuelLoad, type FuelType } from './types'

/**
 * El usuario carga la cantidad y el precio por unidad o el total pagado; calcula lo que falta.
 * Devuelve null si faltan datos o son inválidos.
 */
export function resolveFuelAmounts(input: {
  quantity: number
  unitPrice?: number | null
  total?: number | null
}): { quantity: number; unitPrice: number; total: number } | null {
  const { quantity } = input
  if (!(quantity > 0)) return null
  if (input.total != null && input.total > 0) {
    return { quantity, total: round2(input.total), unitPrice: round2(input.total / quantity) }
  }
  if (input.unitPrice != null && input.unitPrice > 0) {
    return { quantity, unitPrice: round2(input.unitPrice), total: round2(input.unitPrice * quantity) }
  }
  return null
}

function round2(n: number) {
  return Math.round(n * 100) / 100
}

export interface FuelStats {
  /** km por unidad (L o m³) con el método tanque lleno a tanque lleno; null si no hay datos suficientes. */
  consumption: number | null
  totalQuantity: number
  totalSpent: number
  loads: number
  lastUnitPrice: number | null
}

/**
 * Estadísticas de un tipo de combustible.
 * El consumo sólo es confiable si el auto usa un solo combustible: con nafta + GNC los km
 * entre dos cargas de nafta incluyen los recorridos a GNC. Por eso `consumption` se calcula
 * sólo cuando `singleFuel` es true.
 */
export function computeFuelStats(loads: FuelLoad[], fuelType: FuelType, singleFuel: boolean): FuelStats {
  const ofType = loads.filter(l => l.fuelType === fuelType)
  const byDate = [...ofType].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime())
  const totalQuantity = ofType.reduce((s, l) => s + l.quantity, 0)
  const totalSpent = ofType.reduce((s, l) => s + l.total, 0)

  let consumption: number | null = null
  if (singleFuel) {
    const withKm = [...ofType].filter(l => l.km != null).sort((a, b) => a.km! - b.km!)
    let distance = 0
    let quantity = 0
    let prevFullKm: number | null = null
    let pending = 0
    for (const l of withKm) {
      if (prevFullKm == null) {
        if (l.fullTank) prevFullKm = l.km!
        continue
      }
      pending += l.quantity
      if (l.fullTank) {
        distance += l.km! - prevFullKm
        quantity += pending
        prevFullKm = l.km!
        pending = 0
      }
    }
    if (quantity > 0 && distance > 0) consumption = Math.round((distance / quantity) * 10) / 10
  }

  return {
    consumption,
    totalQuantity: round2(totalQuantity),
    totalSpent: round2(totalSpent),
    loads: ofType.length,
    lastUnitPrice: byDate.length ? byDate[byDate.length - 1].unitPrice : null,
  }
}

/**
 * Costo de combustible por km, sumando todos los combustibles.
 * Toma las cargas con km; la primera no cuenta (ese combustible se gasta después).
 */
export function computeCostPerKm(loads: FuelLoad[]): number | null {
  const withKm = loads.filter(l => l.km != null).sort((a, b) => a.km! - b.km!)
  if (withKm.length < 2) return null
  const distance = withKm[withKm.length - 1].km! - withKm[0].km!
  if (distance <= 0) return null
  const spent = withKm.slice(1).reduce((s, l) => s + l.total, 0)
  return round2(spent / distance)
}

/** "Nafta Súper", "Gasoil Premium", "GNC" (o "Nafta" en cargas viejas sin el dato). */
export function fuelLabel(load: Pick<FuelLoad, 'fuelType' | 'grade'>) {
  const name = FUEL_LABELS[load.fuelType]
  return isLiquidFuel(load.fuelType) && load.grade ? `${name} ${FUEL_GRADE_LABELS[load.grade]}` : name
}

export type FuelVariant = { fuelType: FuelType; grade: FuelGrade | null }

/** Último precio pagado por cada variante usada (Nafta Súper, Gasoil Premium, GNC…), de la más reciente a la más vieja. */
export function lastPrices(loads: FuelLoad[]): (FuelVariant & { unitPrice: number; date: string })[] {
  const byDate = [...loads].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime())
  const seen = new Set<string>()
  const out: (FuelVariant & { unitPrice: number; date: string })[] = []
  for (const l of byDate) {
    const key = `${l.fuelType}:${l.grade ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ fuelType: l.fuelType, grade: l.grade, unitPrice: l.unitPrice, date: l.date })
  }
  return out
}
