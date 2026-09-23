import { describe, expect, it } from 'vitest'
import { computeCostPerKm, computeFuelStats, fuelLabel, lastPrices, resolveFuelAmounts } from './fuel'
import { fuelTypeFromDoc, fuelTypesFromDoc } from './parse'
import { computeAvgKmPerDay, validateKmReading } from './odometer'
import { summarizeExpenses } from './expenses'
import { everyWeekday, parseNumberInput } from './format'
import { niceMax } from './scale'
import type { FuelLoad, Job } from './types'

function load(p: Partial<FuelLoad>): FuelLoad {
  return {
    id: Math.random().toString(),
    carId: 'c',
    date: '2026-01-01',
    km: null,
    fuelType: 'nafta',
    grade: 'super',
    quantity: 40,
    unitPrice: 1000,
    total: 40000,
    fullTank: true,
    station: null,
    createdAt: new Date(0),
    ...p,
  }
}

describe('resolveFuelAmounts', () => {
  it('calcula el total desde el precio por litro', () => {
    expect(resolveFuelAmounts({ quantity: 40, unitPrice: 1250.5 })).toEqual({ quantity: 40, unitPrice: 1250.5, total: 50020 })
  })
  it('calcula el precio por unidad desde el total pagado', () => {
    expect(resolveFuelAmounts({ quantity: 12.5, total: 6000 })).toEqual({ quantity: 12.5, unitPrice: 480, total: 6000 })
  })
  it('rechaza datos incompletos', () => {
    expect(resolveFuelAmounts({ quantity: 0, total: 100 })).toBeNull()
    expect(resolveFuelAmounts({ quantity: 10 })).toBeNull()
  })
})

describe('computeFuelStats', () => {
  it('calcula consumo tanque lleno a tanque lleno', () => {
    const loads = [
      load({ km: 1000, quantity: 45 }),
      load({ km: 1300, quantity: 20, fullTank: false }),
      load({ km: 1600, quantity: 30 }), // 600 km con 50 L = 12 km/L
    ]
    const s = computeFuelStats(loads, 'nafta', true)
    expect(s.consumption).toBe(12)
    expect(s.loads).toBe(3)
  })
  it('no calcula consumo si el auto es dual (nafta + GNC)', () => {
    const loads = [load({ km: 1000 }), load({ km: 1500 })]
    expect(computeFuelStats(loads, 'nafta', false).consumption).toBeNull()
  })
  it('separa por tipo de combustible', () => {
    const loads = [load({ total: 100 }), load({ fuelType: 'gnc', total: 50, quantity: 10 })]
    expect(computeFuelStats(loads, 'gnc', false).totalSpent).toBe(50)
  })
})

describe('computeCostPerKm', () => {
  it('ignora la primera carga', () => {
    const loads = [load({ km: 1000, total: 99999 }), load({ km: 1500, total: 30000 }), load({ km: 2000, fuelType: 'gnc', total: 10000 })]
    expect(computeCostPerKm(loads)).toBe(40)
  })
})

describe('computeAvgKmPerDay', () => {
  const now = new Date('2026-06-01T12:00:00Z')
  it('usa las lecturas recientes', () => {
    const readings = [
      { km: 1000, date: new Date('2026-05-01T12:00:00Z') },
      { km: 2500, date: new Date('2026-05-31T12:00:00Z') },
    ]
    expect(computeAvgKmPerDay(readings, now)).toBe(50)
  })
  it('necesita al menos 3 días de diferencia', () => {
    const readings = [
      { km: 1000, date: new Date('2026-05-30T12:00:00Z') },
      { km: 1100, date: new Date('2026-05-31T12:00:00Z') },
    ]
    expect(computeAvgKmPerDay(readings, now)).toBeNull()
  })
})

describe('validateKmReading', () => {
  it('rechaza km menores al actual', () => {
    expect(validateKmReading(900, 1000).ok).toBe(false)
  })
  it('advierte saltos muy grandes', () => {
    const r = validateKmReading(50000, 1000)
    expect(r.ok && r.warning).toBeTruthy()
  })
})

describe('summarizeExpenses', () => {
  it('suma trabajos y combustible por mes y categoría', () => {
    const jobs = [
      { date: '2026-02-12', cost: 100000, category: 'service' },
      { date: '2025-12-01', cost: 5, category: 'otros' },
    ] as Job[]
    const fuel = [load({ date: '2026-02-20', total: 40000 }), load({ date: '2026-03-01', total: 20000 })]
    const s = summarizeExpenses(jobs, fuel, 2026, new Date('2026-03-15'))
    expect(s.total).toBe(160000)
    expect(s.months[1]).toMatchObject({ jobs: 100000, fuel: 40000, total: 140000 })
    expect(s.byCategory[0]).toEqual({ category: 'service', total: 100000 })
    // Febrero (primer mes con gastos) a marzo = 2 meses
    expect(s.monthlyAverage).toBeCloseTo(160000 / 2)
  })

  it('en un año pasado promedia hasta diciembre', () => {
    const jobs = [{ date: '2025-11-01', cost: 1000, category: 'otros' }] as Job[]
    expect(summarizeExpenses(jobs, [], 2025, new Date('2026-03-15')).monthlyAverage).toBe(500)
  })
})

describe('parseNumberInput', () => {
  it('entiende formato argentino', () => {
    expect(parseNumberInput('1.234,5')).toBe(1234.5)
    expect(parseNumberInput('86.420')).toBe(86420)
    expect(parseNumberInput('$ 148500')).toBe(148500)
    expect(parseNumberInput('1250.75')).toBe(1250.75)
    expect(parseNumberInput('')).toBeNull()
  })
})

describe('niceMax', () => {
  it('ajusta el eje al máximo con pasos redondos', () => {
    expect(niceMax(204500)).toEqual({ top: 250000, step: 50000 })
    expect(niceMax(56000)).toEqual({ top: 60000, step: 20000 })
    expect(niceMax(1_200_000)).toEqual({ top: 1_250_000, step: 250000 })
  })
})

describe('everyWeekday', () => {
  it('pluraliza sábado y domingo', () => {
    expect(everyWeekday(0)).toBe('los domingos')
    expect(everyWeekday(2)).toBe('los martes')
    expect(everyWeekday(6)).toBe('los sábados')
  })
})

describe('combustibles: nafta, gasoil y GNC', () => {
  it('arma la etiqueta', () => {
    expect(fuelLabel({ fuelType: 'nafta', grade: 'premium' })).toBe('Nafta Premium')
    expect(fuelLabel({ fuelType: 'nafta', grade: null })).toBe('Nafta')
    expect(fuelLabel({ fuelType: 'gasoil', grade: 'super' })).toBe('Gasoil Súper')
    expect(fuelLabel({ fuelType: 'gasoil', grade: 'premium' })).toBe('Gasoil Premium')
    expect(fuelLabel({ fuelType: 'gnc', grade: null })).toBe('GNC')
  })
  it('calcula el consumo de un auto gasolero', () => {
    const loads = [
      load({ fuelType: 'gasoil', km: 10000, quantity: 50 }),
      load({ fuelType: 'gasoil', grade: 'premium', km: 10800, quantity: 50 }), // 800 km con 50 L = 16 km/L
      load({ fuelType: 'nafta', km: 11000, quantity: 99 }), // de antes de cambiarle el combustible: no cuenta
    ]
    const s = computeFuelStats(loads, 'gasoil', true)
    expect(s.consumption).toBe(16)
    expect(s.loads).toBe(2)
  })
  it('separa el último precio del gasoil súper y premium', () => {
    const loads = [
      load({ date: '2026-09-01', fuelType: 'gasoil', grade: 'super', unitPrice: 1300 }),
      load({ date: '2026-09-03', fuelType: 'gasoil', grade: 'premium', unitPrice: 1500 }),
    ]
    expect(lastPrices(loads).map(p => [p.fuelType, p.grade, p.unitPrice])).toEqual([
      ['gasoil', 'premium', 1500],
      ['gasoil', 'super', 1300],
    ])
  })
  it('lee el combustible de cargas y autos guardados', () => {
    expect(fuelTypeFromDoc('gasoil')).toBe('gasoil')
    expect(fuelTypeFromDoc('gnc')).toBe('gnc')
    expect(fuelTypeFromDoc(undefined)).toBe('nafta')
    expect(fuelTypesFromDoc(['gasoil'])).toEqual(['gasoil'])
    // No existe gasoil + GNC: queda gasoil.
    expect(fuelTypesFromDoc(['gasoil', 'gnc'])).toEqual(['gasoil'])
  })
  it('último precio por variante', () => {
    const loads = [
      load({ date: '2026-09-01', grade: 'super', unitPrice: 1100 }),
      load({ date: '2026-09-10', grade: 'super', unitPrice: 1200 }),
      load({ date: '2026-09-05', grade: 'premium', unitPrice: 1450 }),
      load({ date: '2026-09-08', fuelType: 'gnc', grade: null, unitPrice: 480 }),
    ]
    expect(lastPrices(loads).map(p => [p.fuelType, p.grade, p.unitPrice])).toEqual([
      ['nafta', 'super', 1200],
      ['gnc', null, 480],
      ['nafta', 'premium', 1450],
    ])
  })
  it('un auto viejo "sólo GNC" pasa a nafta + GNC', () => {
    expect(fuelTypesFromDoc(['gnc'])).toEqual(['nafta', 'gnc'])
    expect(fuelTypesFromDoc(['nafta'])).toEqual(['nafta'])
    expect(fuelTypesFromDoc(undefined)).toEqual(['nafta'])
  })
})
