import { describe, expect, it } from 'vitest'
import { addInterval, addMonths } from './dates'
import {
  compareRuleStates,
  defaultWarnings,
  describeRemaining,
  describeRuleInterval,
  activeRules,
  describeProjectionChange,
  formatLastDoneKm,
  getRuleState,
  isCompleted,
  jobChangeDiff,
  jobDoneKm,
  kmRulesOf,
  missingLastKm,
  projectionDiff,
  projectionPatch,
  projectRule,
  summarizeRule,
  type ProjectionJob,
} from './maintenance'
import { formatDate } from './format'
import { linkedReadingId, readingDateOf } from './odometer'
import { intervalFromDoc } from './parse'
import type { MaintenanceRule, TimeInterval } from './types'

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
  baseKm: 30_000,
  baseDate: '2025-06-01',
  lastDoneKm: 30_000,
  lastDoneKmEstimated: false,
  lastDoneDate: '2025-06-01',
  lastDoneJobId: null,
  completedByJobId: null,
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
  ...extra,
})

const odo = (id: string, km: number, date: string, carId = 'c1') => ({ id, carId, km, date: readingDateOf(date) })

const work = (extra: Partial<ProjectionJob> = {}): ProjectionJob => ({
  id: 'j1',
  carId: 'c1',
  date: '2026-02-01',
  km: null,
  ruleIds: ['s'],
  status: 'approved',
  createdAt: new Date('2026-02-01T10:00:00'),
  ...extra,
})

/** 01/01 con 40.000 km y 01/03 con 46.000 km. */
const series = [odo('a', 40_000, '2026-01-01'), odo('b', 46_000, '2026-03-01')]

const fromBase = (rule: MaintenanceRule) => ({
  lastDoneKm: rule.baseKm,
  lastDoneDate: rule.baseDate,
  lastDoneKmEstimated: false,
  lastDoneJobId: null,
  completedByJobId: null,
})

/** Los mantenimientos después de escribir los cambios, como los vería la app en la próxima foto. */
const applied = (rules: MaintenanceRule[], changes: { ruleId: string; patch: object }[]) =>
  rules.map(r => ({ ...r, ...changes.find(c => c.ruleId === r.id)?.patch }))

describe('projectRule', () => {
  it('sin trabajos, la base', () => {
    const rule = mrule('s')
    expect(projectRule(rule, [], series)).toEqual(fromBase(rule))
  })
  it('un trabajo más nuevo que la base manda, con su km y su fecha', () => {
    expect(projectRule(mrule('s'), [work({ km: 42_000 })], series)).toEqual({
      lastDoneKm: 42_000,
      lastDoneDate: '2026-02-01',
      lastDoneKmEstimated: false,
      lastDoneJobId: 'j1',
      completedByJobId: null,
    })
  })
  it('un trabajo del 01/02 sin km, con lecturas de 40.000 (01/01) y 46.000 (01/03), da ≈43.000 km estimado', () => {
    expect(projectRule(mrule('s'), [work()], series)).toMatchObject({ lastDoneKm: 43_153, lastDoneKmEstimated: true, lastDoneJobId: 'j1' })
  })
  it('un trabajo más viejo que la base no cuenta', () => {
    const rule = mrule('s', { baseDate: '2026-02-10', lastDoneDate: '2026-02-10' })
    expect(projectRule(rule, [work({ km: 42_000 })], series)).toEqual(fromBase(rule))
  })
  it('un trabajo de la misma fecha que la base le gana', () => {
    expect(projectRule(mrule('s', { baseDate: '2026-02-01' }), [work({ km: 43_500 })], series)).toMatchObject({
      lastDoneKm: 43_500,
      lastDoneJobId: 'j1',
    })
  })
  it('entre dos trabajos de la misma fecha manda el cargado después (createdAt)', () => {
    const first = work({ id: 'j1', km: 42_000, createdAt: new Date('2026-02-01T09:00:00') })
    const second = work({ id: 'j2', km: 42_100, createdAt: new Date('2026-02-01T18:00:00') })
    expect(projectRule(mrule('s'), [second, first], series)).toMatchObject({ lastDoneKm: 42_100, lastDoneJobId: 'j2' })
    expect(projectRule(mrule('s'), [first, second], series)).toMatchObject({ lastDoneJobId: 'j2' })
  })
  it('manda el más reciente aunque se haya cargado antes', () => {
    const recent = work({ id: 'j1', date: '2026-02-20', km: 44_000, createdAt: new Date('2026-02-20T10:00:00') })
    const older = work({ id: 'j2', date: '2026-02-01', km: 42_000, createdAt: new Date('2026-03-01T10:00:00') })
    expect(projectRule(mrule('s'), [recent, older], series)).toMatchObject({ lastDoneDate: '2026-02-20', lastDoneJobId: 'j1' })
  })
  it('ignora los trabajos pendientes y los rechazados', () => {
    const rule = mrule('s')
    const jobs = [work({ id: 'p', status: 'pending', km: 42_000 }), work({ id: 'r', status: 'rejected', km: 42_000 })]
    expect(projectRule(rule, jobs, series)).toEqual(fromBase(rule))
  })
  it('un trabajo sin estado (viejo) cuenta como aprobado', () => {
    expect(projectRule(mrule('s'), [work({ status: undefined, km: 42_000 })], series)).toMatchObject({ lastDoneJobId: 'j1' })
  })
  it('ignora los trabajos que no lo marcan y los de otro auto', () => {
    const rule = mrule('s')
    const jobs = [work({ ruleIds: ['otro'], km: 42_000 }), work({ id: 'x', carId: 'c2', km: 42_000 })]
    expect(projectRule(rule, jobs, series)).toEqual(fromBase(rule))
  })
  it('corregir la fecha de un trabajo de 2027 a 2026 la toma: no queda la fecha futura', () => {
    const rule = mrule('s', { lastDoneDate: '2027-02-01', lastDoneKm: 42_000, lastDoneJobId: 'j1' })
    expect(projectRule(rule, [work({ date: '2026-02-01', km: 42_000 })], series)).toMatchObject({ lastDoneDate: '2026-02-01' })
  })
  it('nunca usa el km de hoy: un trabajo de hace 2 meses toma el km estimado a esa fecha', () => {
    const readings = [odo('a', 50_000, '2026-08-01'), odo('today', 60_000, '2026-10-20')]
    expect(projectRule(mrule('s'), [work({ date: '2026-08-20' })], readings)).toMatchObject({
      lastDoneKm: 52_375,
      lastDoneKmEstimated: true,
      lastDoneDate: '2026-08-20',
    })
  })
  it('sin km y anterior a la primera lectura: la parte de km queda en null, sin marcarla estimada', () => {
    expect(projectRule(mrule('s'), [work({ date: '2025-12-01' })], series)).toMatchObject({
      lastDoneKm: null,
      lastDoneKmEstimated: false,
      lastDoneDate: '2025-12-01',
    })
  })
  it('no cuenta la lectura del propio trabajo ni las de otro auto', () => {
    const readings = [...series, odo(linkedReadingId('job', 'j1'), 99_999, '2026-02-01'), odo('x', 90_000, '2026-02-01', 'c2')]
    expect(projectRule(mrule('s'), [work()], readings)).toMatchObject({ lastDoneKm: 43_153, lastDoneKmEstimated: true })
  })
  it('sin intervalo de km toma la fecha del trabajo y el km queda en null', () => {
    const vtv = mrule('s', { intervalKm: null, baseKm: null, lastDoneKm: null })
    expect(projectRule(vtv, [work({ km: 42_000 })], series)).toEqual({
      lastDoneKm: null,
      lastDoneDate: '2026-02-01',
      lastDoneKmEstimated: false,
      lastDoneJobId: 'j1',
      completedByJobId: null,
    })
  })
  it('un recordatorio de una vez queda cumplido por el trabajo y conserva su base', () => {
    const once = mrule('s', { repeat: false, intervalKm: null, baseKm: null, baseDate: '2026-01-15', lastDoneDate: '2026-01-15' })
    expect(projectRule(once, [work()], series)).toEqual({ ...fromBase(once), completedByJobId: 'j1' })
  })
  it('sin el trabajo que lo cumplió, el recordatorio vuelve a estar activo', () => {
    const once = mrule('s', { repeat: false, intervalKm: null, baseKm: null, baseDate: '2026-01-15', completedByJobId: 'j1' })
    expect(projectRule(once, [], series)).toEqual(fromBase(once))
  })
  it('con la base en null (la explicaba un trabajo), sin trabajos queda sin dato', () => {
    const rule = mrule('s', { baseKm: null, baseDate: null })
    expect(projectRule(rule, [work({ km: 42_000 })], series)).toMatchObject({ lastDoneDate: '2026-02-01', lastDoneKm: 42_000 })
    expect(projectRule(rule, [], series)).toEqual({
      lastDoneKm: null,
      lastDoneDate: null,
      lastDoneKmEstimated: false,
      lastDoneJobId: null,
      completedByJobId: null,
    })
  })
})

describe('projectionDiff', () => {
  const jobs = [
    work({ id: 'j1', km: 42_000, ruleIds: ['s', 'once'] }),
    work({ id: 'j2', date: '2026-02-20', ruleIds: ['s'], createdAt: new Date('2026-02-20T10:00:00') }),
  ]
  const rules = [
    mrule('s'),
    mrule('vtv', { intervalKm: null, baseKm: null, lastDoneKm: null }),
    mrule('once', { repeat: false, intervalKm: null, baseKm: null, baseDate: '2026-01-15', lastDoneDate: '2026-01-15' }),
  ]

  it('aplicar el diff y volver a calcular da vacío (idempotencia)', () => {
    const changes = projectionDiff(rules, jobs, series)
    expect(changes.map(c => c.ruleId)).toEqual(['s', 'once'])
    expect(projectionDiff(applied(rules, changes), jobs, series)).toEqual([])
  })
  it('un mantenimiento al día no genera cambios', () => {
    expect(projectionDiff([mrule('s')], [], series)).toEqual([])
  })
  it('si cambia la fecha o el cumplido, vuelve a avisar', () => {
    const changes = projectionDiff(rules, jobs, series)
    expect(changes.find(c => c.ruleId === 's')?.patch).toMatchObject({
      lastDoneDate: '2026-02-20',
      lastDoneKmEstimated: true,
      lastDoneJobId: 'j2',
      lastNotifiedAt: null,
      lastNotifiedStatus: null,
    })
    expect(changes.find(c => c.ruleId === 'once')?.patch).toMatchObject({
      completedByJobId: 'j1',
      lastNotifiedAt: null,
      lastNotifiedStatus: null,
    })
  })
  it('un km estimado que se ajusta (otra lectura) se guarda sin volver a avisar', () => {
    const stored = mrule('s', { lastDoneKm: 43_000, lastDoneKmEstimated: true, lastDoneDate: '2026-02-01', lastDoneJobId: 'j1' })
    const [change] = projectionDiff([stored], [work()], series)
    expect(change.patch).toEqual({
      lastDoneKm: 43_153,
      lastDoneDate: '2026-02-01',
      lastDoneKmEstimated: true,
      lastDoneJobId: 'j1',
      completedByJobId: null,
    })
  })
  it('un estimado que pasa a ser el km del trabajo vuelve a avisar', () => {
    const stored = mrule('s', { lastDoneKm: 43_153, lastDoneKmEstimated: true, lastDoneDate: '2026-02-01', lastDoneJobId: 'j1' })
    const [change] = projectionDiff([stored], [work({ km: 44_000 })], series)
    expect(change.patch).toMatchObject({ lastDoneKm: 44_000, lastDoneKmEstimated: false, lastNotifiedAt: null })
  })
  it('si sólo cambia el trabajo que lo explica (misma fecha y km), no vuelve a avisar', () => {
    const stored = mrule('s', { lastDoneKm: 42_000, lastDoneDate: '2026-02-01', lastDoneJobId: 'j1' })
    const other = work({ id: 'j2', km: 42_000, createdAt: new Date('2026-02-01T18:00:00') })
    const [change] = projectionDiff([stored], [work({ km: 42_000 }), other], series)
    expect(change.patch).not.toHaveProperty('lastNotifiedAt')
    expect(change.patch.lastDoneJobId).toBe('j2')
  })
  it('en un mantenimiento sin intervalo de km, el km no hace volver a avisar', () => {
    const stored = mrule('s', { intervalKm: null, lastDoneKm: 12_000, lastDoneDate: '2026-02-01', lastDoneJobId: 'j1' })
    const [change] = projectionDiff([stored], [work({ km: 42_000 })], series)
    expect(change.patch).toEqual({ ...fromBase(stored), lastDoneKm: null, lastDoneDate: '2026-02-01', lastDoneJobId: 'j1' })
  })
})

describe('projectionPatch', () => {
  it('null si la proyección guardada ya es la calculada', () => {
    const rule = mrule('s')
    expect(projectionPatch(rule, fromBase(rule))).toBeNull()
  })
  it('un km no estimado que cambia vuelve a avisar', () => {
    expect(projectionPatch(mrule('s'), { ...fromBase(mrule('s')), lastDoneKm: 31_000 })).toMatchObject({ lastNotifiedStatus: null })
  })
})

describe('jobChangeDiff', () => {
  const older = work({ id: 'old', date: '2026-01-10', km: 40_500, createdAt: new Date('2026-01-10T10:00:00') })
  const job = work({ id: 'j1', km: 42_000 })
  const stored = mrule('s', { lastDoneKm: 42_000, lastDoneDate: '2026-02-01', lastDoneJobId: 'j1' })

  it('le saco el mantenimiento a un trabajo aprobado y vuelve a su trabajo anterior', () => {
    const changes = jobChangeDiff({ rules: [stored], jobs: [older, job], readings: series, before: job, after: { ...job, ruleIds: [] } })
    expect(changes).toEqual([
      {
        ruleId: 's',
        carId: 'c1',
        patch: {
          lastDoneKm: 40_500,
          lastDoneDate: '2026-01-10',
          lastDoneKmEstimated: false,
          lastDoneJobId: 'old',
          completedByJobId: null,
          lastNotifiedAt: null,
          lastNotifiedStatus: null,
        },
      },
    ])
  })
  it('borro un trabajo aprobado y vuelve a la base; "Deshacer" con los datos de antes lo deja como estaba', () => {
    const removed = jobChangeDiff({ rules: [stored], jobs: [job], readings: series, before: job, after: null })
    expect(removed[0].patch).toMatchObject(fromBase(stored))
    const restored = jobChangeDiff({ rules: [stored], jobs: [job], readings: series, before: null, after: job })
    expect(restored[0].patch).toMatchObject({ lastDoneKm: 42_000, lastDoneDate: '2026-02-01', lastDoneJobId: 'j1' })
  })
  it('rechazar un trabajo aprobado lo deja de contar', () => {
    const changes = jobChangeDiff({ rules: [stored], jobs: [job], readings: series, before: job, after: { ...job, status: 'rejected' } })
    expect(changes[0].patch).toMatchObject(fromBase(stored))
  })
  it('un trabajo pendiente no cambia nada', () => {
    const pending = { ...job, status: 'pending' as const }
    expect(jobChangeDiff({ rules: [mrule('s')], jobs: [], readings: series, before: null, after: pending })).toEqual([])
  })
  it('un recordatorio cumplido vuelve a estar activo si se borra el trabajo', () => {
    const once = mrule('once', { repeat: false, intervalKm: null, baseKm: null, baseDate: '2026-01-15', completedByJobId: 'j1' })
    const done = { ...job, ruleIds: ['once'] }
    const [change] = jobChangeDiff({ rules: [once], jobs: [done], readings: series, before: done, after: null })
    expect(change.patch).toMatchObject({ completedByJobId: null, lastNotifiedAt: null })
  })
  it('ignora los mantenimientos que ya no existen', () => {
    expect(jobChangeDiff({ rules: [], jobs: [job], readings: series, before: job, after: null })).toEqual([])
  })
})

describe('mantenimientos cumplidos', () => {
  it('un cumplido no es activo', () => {
    const rules = [mrule('a'), mrule('b', { repeat: false, completedByJobId: 'j1' })]
    expect(isCompleted(rules[1])).toBe(true)
    expect(activeRules(rules).map(r => r.id)).toEqual(['a'])
  })
  it('describe cómo queda cada mantenimiento', () => {
    const rule = mrule('s', { lastDoneDate: '2026-02-01' })
    expect(describeProjectionChange(rule, fromBase(rule))).toBe(`Service vuelve a ${formatDate('2025-06-01')} · 30.000 km`)
    expect(describeProjectionChange({ ...rule, repeat: false }, { ...fromBase(rule), completedByJobId: 'j1' })).toBe('Service queda cumplido')
    expect(describeProjectionChange({ ...rule, repeat: false }, fromBase(rule))).toBe('Service vuelve a estar activo')
    expect(describeProjectionChange(rule, { ...fromBase(rule), lastDoneDate: null })).toBe('Service queda sin la última vez')
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
  it('justo en el km dice "llegó al km", no "pasado -0 km"', () => {
    const s = getRuleState(service, { currentKm: 15000, avgKmPerDay: null }, '2026-12-22')
    expect(describeRemaining(s).km).toBe('llegó al km')
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
