import { describe, expect, it } from 'vitest'
import { addInterval, addMonths } from './dates'
import { compareRuleStates, defaultWarnings, describeRemaining, describeRuleInterval, getRuleState, summarizeRule } from './maintenance'
import { intervalFromDoc } from './parse'
import type { TimeInterval } from './types'

const months = (amount: number): TimeInterval => ({ amount, unit: 'month' })
const base = { warnKm: 500, warnDays: 30 }
const service = { ...base, intervalKm: 5000, intervalTime: months(12), lastDoneKm: 10000, lastDoneDate: '2026-01-10' }

describe('getRuleState', () => {
  it('está al día lejos de ambos límites', () => {
    const s = getRuleState(service, { currentKm: 11000, avgKmPerDay: null }, '2026-03-01')
    expect(s.status).toBe('ok')
    expect(s.nextKm).toBe(15000)
    expect(s.nextDate).toBe('2027-01-10')
    expect(s.remainingKm).toBe(4000)
  })

  it('pasa a "pronto" al entrar en el margen de km', () => {
    const s = getRuleState(service, { currentKm: 14600, avgKmPerDay: null }, '2026-03-01')
    expect(s.status).toBe('soon')
    expect(s.remainingKm).toBe(400)
    expect(s.dueBy).toBe('km')
  })

  it('pasa a "pronto" al entrar en el margen de días aunque falten muchos km', () => {
    const s = getRuleState(service, { currentKm: 11000, avgKmPerDay: null }, '2026-12-20')
    expect(s.status).toBe('soon')
    expect(s.remainingDays).toBe(21)
    expect(s.dueBy).toBe('date')
  })

  it('vence por km aunque falte tiempo (lo que ocurra primero)', () => {
    const s = getRuleState(service, { currentKm: 15200, avgKmPerDay: null }, '2026-03-01')
    expect(s.status).toBe('overdue')
    expect(s.remainingKm).toBe(-200)
  })

  it('vence por fecha aunque falten km', () => {
    const s = getRuleState(service, { currentKm: 12000, avgKmPerDay: null }, '2027-01-11')
    expect(s.status).toBe('overdue')
    expect(s.remainingDays).toBe(-1)
  })

  it('soporta reglas sólo por tiempo (VTV)', () => {
    const vtv = { ...base, intervalKm: null, intervalTime: months(12), lastDoneKm: null, lastDoneDate: '2026-05-01' }
    const s = getRuleState(vtv, { currentKm: 50000, avgKmPerDay: 40 }, '2026-06-01')
    expect(s.status).toBe('ok')
    expect(s.remainingKm).toBeNull()
    expect(s.dueBy).toBe('date')
    expect(s.estimatedKmDate).toBeNull()
  })

  it('soporta reglas sólo por km', () => {
    const rot = { ...base, intervalKm: 10000, intervalTime: null, lastDoneKm: 20000, lastDoneDate: null }
    const s = getRuleState(rot, { currentKm: 25000, avgKmPerDay: null }, '2026-06-01')
    expect(s.status).toBe('ok')
    expect(s.nextDate).toBeNull()
    expect(s.progress).toBe(50)
  })

  it('estima la fecha por km con el uso promedio y avisa si llega dentro del margen de días', () => {
    // faltan 1000 km a 50 km/día = 20 días -> dentro de los 30 días de aviso
    const s = getRuleState(service, { currentKm: 14000, avgKmPerDay: 50 }, '2026-03-01')
    expect(s.estimatedKmDate).toBe('2026-03-21')
    expect(s.daysUntilDue).toBe(20)
    expect(s.status).toBe('soon')
    expect(s.dueBy).toBe('km')
  })

  it('sin intervalos es "unknown"', () => {
    const s = getRuleState(
      { ...base, intervalKm: null, intervalTime: null, lastDoneKm: null, lastDoneDate: null },
      { currentKm: 1000, avgKmPerDay: null },
      '2026-01-01',
    )
    expect(s.status).toBe('unknown')
  })
})

describe('compareRuleStates', () => {
  it('ordena vencidos, luego próximos, luego al día', () => {
    const car = { currentKm: 14600, avgKmPerDay: null }
    const overdue = getRuleState({ ...service, lastDoneKm: 9000 }, car, '2026-03-01')
    const soon = getRuleState(service, car, '2026-03-01')
    const ok = getRuleState({ ...service, lastDoneKm: 14000 }, car, '2026-03-01')
    expect([ok, overdue, soon].sort(compareRuleStates)).toEqual([overdue, soon, ok])
  })
})

describe('describeRemaining', () => {
  it('describe km y días', () => {
    const s = getRuleState(service, { currentKm: 14580, avgKmPerDay: null }, '2026-12-22')
    expect(describeRemaining(s)).toEqual({ km: 'faltan 420 km', date: 'vence en 19 días' })
  })
})

describe('addMonths', () => {
  it('ajusta al último día del mes', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28')
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
  })
})

describe('summarizeRule', () => {
  it('usa el límite que vence primero', () => {
    expect(summarizeRule('Service', getRuleState(service, { currentKm: 14600, avgKmPerDay: null }, '2026-03-01'))).toBe(
      'Service: faltan 400 km',
    )
    expect(summarizeRule('Service', getRuleState(service, { currentKm: 11000, avgKmPerDay: null }, '2026-12-20'))).toBe(
      'Service: vence en 21 días',
    )
  })
  it('marca los vencidos', () => {
    expect(summarizeRule('Service', getRuleState(service, { currentKm: 15200, avgKmPerDay: null }, '2026-03-01'))).toBe(
      'Service: vencido (pasado 200 km)',
    )
  })
})

describe('intervalos en semanas, meses y años', () => {
  it('suma el lapso a la fecha', () => {
    expect(addInterval('2026-09-22', { amount: 3, unit: 'week' })).toBe('2026-10-13')
    expect(addInterval('2026-09-22', { amount: 10, unit: 'day' })).toBe('2026-10-02')
    expect(addInterval('2026-01-31', { amount: 1, unit: 'month' })).toBe('2026-02-28')
    expect(addInterval('2024-02-29', { amount: 1, unit: 'year' })).toBe('2025-02-28')
  })

  it('un "volver en 3 semanas" pasa a próximo la última semana', () => {
    const vuelta = { intervalKm: null, intervalTime: { amount: 3, unit: 'week' as const }, lastDoneKm: null, lastDoneDate: '2026-09-22', ...defaultWarnings(null, { amount: 3, unit: 'week' }) }
    expect(vuelta.warnDays).toBe(5)
    expect(getRuleState(vuelta, { currentKm: 0, avgKmPerDay: null }, '2026-10-01').status).toBe('ok')
    expect(getRuleState(vuelta, { currentKm: 0, avgKmPerDay: null }, '2026-10-09').status).toBe('soon')
    expect(getRuleState(vuelta, { currentKm: 0, avgKmPerDay: null }, '2026-10-14').status).toBe('overdue')
  })

  it('describe el intervalo', () => {
    expect(describeRuleInterval({ intervalKm: 5000, intervalTime: { amount: 1, unit: 'year' }, repeat: true })).toBe('Cada 5.000 km o 1 año')
    expect(describeRuleInterval({ intervalKm: null, intervalTime: { amount: 3, unit: 'week' }, repeat: false })).toBe(
      'Una sola vez, dentro de 3 semanas',
    )
  })

  it('los márgenes de aviso son proporcionales al intervalo', () => {
    expect(defaultWarnings(5000, { amount: 1, unit: 'year' })).toEqual({ warnKm: 500, warnDays: 30 })
    expect(defaultWarnings(1000, { amount: 1, unit: 'month' })).toEqual({ warnKm: 200, warnDays: 8 })
    expect(defaultWarnings(null, { amount: 1, unit: 'week' })).toEqual({ warnKm: 500, warnDays: 2 })
  })

  it('lee el formato viejo en meses', () => {
    expect(intervalFromDoc({ intervalMonths: 12 })).toEqual({ amount: 12, unit: 'month' })
    expect(intervalFromDoc({ intervalTime: { amount: 3, unit: 'week' } })).toEqual({ amount: 3, unit: 'week' })
    expect(intervalFromDoc({ intervalTime: { amount: 0, unit: 'week' } })).toBeNull()
    expect(intervalFromDoc({})).toBeNull()
  })
})
