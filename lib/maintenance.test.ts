import { describe, expect, it } from 'vitest'
import { addInterval, addMonths } from './dates'
import {
  compareRuleStates,
  defaultWarnings,
  describeRemaining,
  describeRuleInterval,
  formatLastDoneKm,
  getRuleState,
  jobDoneKm,
  jobRuleUpdates,
  kmRulesOf,
  missingLastKm,
  summarizeRule,
} from './maintenance'
import { linkedReadingId, readingDateOf } from './odometer'
import { intervalFromDoc } from './parse'
import type { Job, MaintenanceRule, TimeInterval } from './types'

const months = (amount: number): TimeInterval => ({ amount, unit: 'month' })
const base = { warnKm: 500, warnDays: 30 }
const service = { ...base, intervalKm: 5000, intervalTime: months(12), lastDoneKm: 10000, lastDoneDate: '2026-01-10' }

const mrule = (id: string, extra: Partial<MaintenanceRule> = {}): MaintenanceRule => ({
  id,
  carId: 'c1',
  name: 'Service',
  intervalKm: 5000,
  intervalTime: months(12),
  repeat: true,
  lastDoneKm: 30_000,
  lastDoneKmEstimated: false,
  lastDoneDate: '2025-06-01',
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
  ...extra,
})

const odo = (id: string, km: number, date: string, carId = 'c1') => ({ id, carId, km, date: readingDateOf(date) })

const work = (extra: Partial<Pick<Job, 'id' | 'carId' | 'date' | 'km' | 'ruleIds'>> = {}) => ({
  id: 'j1',
  carId: 'c1',
  date: '2026-02-01',
  km: null as number | null,
  ruleIds: ['s'],
  ...extra,
})

/** 01/01 con 40.000 km y 01/03 con 46.000 km. */
const series = [odo('a', 40_000, '2026-01-01'), odo('b', 46_000, '2026-03-01')]

describe('jobRuleUpdates', () => {
  it('un trabajo del 01/02 sin km, con lecturas de 40.000 (01/01) y 46.000 (01/03), marca el service con ≈43.000 km, estimado', () => {
    expect(jobRuleUpdates([mrule('s')], work(), series)).toEqual([
      { ruleId: 's', action: 'update', lastDoneKm: 43_153, lastDoneKmEstimated: true, lastDoneDate: '2026-02-01' },
    ])
  })
  it('con km usa el del trabajo y no es estimado', () => {
    expect(jobRuleUpdates([mrule('s')], work({ km: 42_000 }), series)).toEqual([
      { ruleId: 's', action: 'update', lastDoneKm: 42_000, lastDoneKmEstimated: false, lastDoneDate: '2026-02-01' },
    ])
  })
  it('nunca usa el km de hoy: un trabajo de hace 2 meses aprobado hoy toma el km de esa fecha', () => {
    const readings = [odo('a', 50_000, '2026-08-01'), odo('today', 60_000, '2026-10-20')]
    const [u] = jobRuleUpdates([mrule('s')], work({ date: '2026-08-20' }), readings)
    expect(u).toMatchObject({ action: 'update', lastDoneKm: 52_375, lastDoneKmEstimated: true, lastDoneDate: '2026-08-20' })
  })
  it('anterior a la primera lectura y sin km: deja la parte de km en null, sin marcarla estimada', () => {
    expect(jobRuleUpdates([mrule('s')], work({ date: '2025-12-01' }), series)).toEqual([
      { ruleId: 's', action: 'update', lastDoneKm: null, lastDoneKmEstimated: false, lastDoneDate: '2025-12-01' },
    ])
  })
  it('no cuenta la lectura del propio trabajo (se borra en el mismo batch si se le sacó el km)', () => {
    const readings = [...series, odo(linkedReadingId('job', 'j1'), 99_999, '2026-02-01')]
    const [u] = jobRuleUpdates([mrule('s')], work(), readings)
    expect(u).toMatchObject({ lastDoneKm: 43_153, lastDoneKmEstimated: true })
  })
  it('no mezcla lecturas de otro auto', () => {
    const readings = [...series, odo('x', 90_000, '2026-02-01', 'c2')]
    expect(jobRuleUpdates([mrule('s')], work(), readings)[0]).toMatchObject({ lastDoneKm: 43_153 })
  })
  it('los de una sola vez se borran', () => {
    expect(jobRuleUpdates([mrule('s', { repeat: false })], work(), series)).toEqual([{ ruleId: 's', action: 'delete' }])
  })
  it('no toca un mantenimiento hecho después del trabajo', () => {
    expect(jobRuleUpdates([mrule('s', { lastDoneDate: '2026-02-10' })], work(), series)).toEqual([])
  })
  it('el mismo día que la última vez sí lo reinicia', () => {
    expect(jobRuleUpdates([mrule('s', { lastDoneDate: '2026-02-01' })], work({ km: 43_500 }), series)).toHaveLength(1)
  })
  it('sin intervalo de km conserva su km (y su marca de estimado)', () => {
    const vtv = mrule('s', { intervalKm: null, lastDoneKm: 12_000, lastDoneKmEstimated: true })
    expect(jobRuleUpdates([vtv], work(), series)).toEqual([
      { ruleId: 's', action: 'update', lastDoneKm: 12_000, lastDoneKmEstimated: true, lastDoneDate: '2026-02-01' },
    ])
  })
  it('ignora los mantenimientos que el trabajo no marcó', () => {
    expect(jobRuleUpdates([mrule('s'), mrule('otro')], work(), series).map(u => u.ruleId)).toEqual(['s'])
  })
})

describe('jobDoneKm', () => {
  it('un trabajo nuevo (sin id) estima con todas las lecturas del auto', () => {
    expect(jobDoneKm({ carId: 'c1', date: '2026-02-01', km: null }, series)).toEqual({ km: 43_153, estimated: true })
  })
  it('una lectura del mismo día da su km, pero cuenta como estimado porque no es el km del trabajo', () => {
    expect(jobDoneKm({ carId: 'c1', date: '2026-03-01', km: null }, series)).toEqual({ km: 46_000, estimated: true })
  })
  it('con km, el del trabajo', () => {
    expect(jobDoneKm({ id: 'j1', carId: 'c1', date: '2026-02-01', km: 41_000 }, series)).toEqual({ km: 41_000, estimated: false })
  })
})

describe('kmRulesOf', () => {
  it('sólo los marcados que se repiten y tienen intervalo de km', () => {
    const rules = [mrule('a'), mrule('b', { intervalKm: null }), mrule('c', { repeat: false }), mrule('d')]
    expect(kmRulesOf(rules, ['a', 'b', 'c']).map(r => r.id)).toEqual(['a'])
  })
})

describe('km de la última vez', () => {
  it('un km estimado se muestra como tal', () => {
    expect(formatLastDoneKm({ lastDoneKm: 48_300, lastDoneKmEstimated: true })).toBe('≈ 48.300 km (estimado)')
    expect(formatLastDoneKm({ lastDoneKm: 48_300, lastDoneKmEstimated: false })).toBe('48.300 km')
    expect(formatLastDoneKm({ lastDoneKm: null, lastDoneKmEstimated: false })).toBeNull()
  })
  it('a un mantenimiento por km sin km de la última vez le falta el dato', () => {
    expect(missingLastKm({ intervalKm: 5000, lastDoneKm: null })).toBe(true)
    expect(missingLastKm({ intervalKm: 5000, lastDoneKm: 40_000 })).toBe(false)
    expect(missingLastKm({ intervalKm: null, lastDoneKm: null })).toBe(false)
  })
  it('sin el km de la última vez se calcula sólo por fecha; sin intervalo de tiempo queda "unknown"', () => {
    const noKm = { ...service, lastDoneKm: null }
    const s = getRuleState(noKm, { currentKm: 60_000, avgKmPerDay: null }, '2026-03-01')
    expect(s.nextKm).toBeNull()
    expect(s.dueBy).toBe('date')
    expect(s.status).toBe('ok')
    expect(getRuleState({ ...noKm, intervalTime: null }, { currentKm: 60_000, avgKmPerDay: null }, '2026-03-01').status).toBe('unknown')
  })
})

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
