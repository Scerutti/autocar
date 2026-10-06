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
    const withoutKm = ofType.filter(l => l.km == null)
    let distance = 0
    let quantity = 0
    let prevFull: FuelLoad | null = null
    let pending = 0
    for (const l of withKm) {
      if (prevFull == null) {
        if (l.fullTank) prevFull = l
        continue
      }
      pending += l.quantity
      if (l.fullTank) {
        // Las cargas sin km también se gastaron en este tramo: se ubican por fecha entre los dos tanques llenos.
        pending += sumBetween(withoutKm, prevFull, l, x => x.quantity)
        distance += l.km! - prevFull.km!
        quantity += pending
        prevFull = l
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

/** Orden de carga: por fecha y, el mismo día, por cuándo se registró. */
function loadOrder(a: FuelLoad, b: FuelLoad) {
  return a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime()
}

/** Suma de las cargas que quedan estrictamente después de `from` y antes de `to`. */
function sumBetween(loads: FuelLoad[], from: FuelLoad, to: FuelLoad, value: (l: FuelLoad) => number) {
  return loads.filter(l => loadOrder(from, l) < 0 && loadOrder(l, to) < 0).reduce((s, l) => s + value(l), 0)
}

/**
 * Costo de combustible por km, sumando todos los combustibles.
 * Toma las cargas con km; la primera no cuenta (ese combustible se gasta después). Las cargas sin km
 * que caen por fecha entre la primera y la última también se pagaron en ese recorrido.
 */
export function computeCostPerKm(loads: FuelLoad[]): number | null {
  const withKm = loads.filter(l => l.km != null).sort((a, b) => a.km! - b.km!)
  if (withKm.length < 2) return null
  const first = withKm[0]
  const last = withKm[withKm.length - 1]
  const distance = last.km! - first.km!
  if (distance <= 0) return null
  const withoutKm = loads.filter(l => l.km == null)
  const spent = withKm.slice(1).reduce((s, l) => s + l.total, 0) + sumBetween(withoutKm, first, last, l => l.total)
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
