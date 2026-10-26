import { describe, expect, it } from 'vitest'
import { chunk, hasBase, planCarRebase } from './rebase-rules-plan.mjs'

const doc = (id, data) => ({ id, data })

const car = doc('c1', { ownerUid: 'owner' })

const rule = (id, data = {}) =>
  doc(id, { carId: 'c1', name: 'Service', intervalKm: 5000, repeat: true, lastDoneKm: 40_000, lastDoneDate: '2026-03-12', ...data })

const job = (id, data = {}) =>
  doc(id, { carId: 'c1', date: '2026-03-12', km: 40_000, ruleIds: ['s'], status: 'approved', ...data })

/** Los mantenimientos después de escribir (para simular una segunda corrida). */
function applied(rules, writes) {
  return rules.map(r => {
    const w = writes.find(x => x.path.endsWith(`/${r.id}`))
    return w ? doc(r.id, { ...r.data, ...w.data }) : r
  })
}

describe('planCarRebase', () => {
  it('si un trabajo aprobado que lo marca tiene la fecha de la última vez, la base queda en null', () => {
    const plan = planCarRebase({ car, rules: [rule('s')], jobs: [job('j1')] })
    expect(plan.writes).toEqual([{ path: 'cars/c1/rules/s', data: { baseKm: null, baseDate: null } }])
    expect(plan.report).toEqual({ carId: 'c1', own: 0, fromJob: 1, skipped: 0 })
  })

  it('si no lo explica un trabajo, la base es la última vez guardada', () => {
    const plan = planCarRebase({ car, rules: [rule('s')], jobs: [job('j1', { date: '2026-01-05' })] })
    expect(plan.writes).toEqual([{ path: 'cars/c1/rules/s', data: { baseKm: 40_000, baseDate: '2026-03-12' } }])
    expect(plan.report).toMatchObject({ own: 1, fromJob: 0 })
  })

  it('un trabajo de esa fecha que no lo marca no lo explica', () => {
    const plan = planCarRebase({ car, rules: [rule('s')], jobs: [job('j1', { ruleIds: ['otro'] })] })
    expect(plan.writes[0].data).toEqual({ baseKm: 40_000, baseDate: '2026-03-12' })
  })

  it('los trabajos pendientes y rechazados no explican nada; uno sin estado (viejo) sí', () => {
    const pending = planCarRebase({ car, rules: [rule('s')], jobs: [job('p', { status: 'pending' }), job('r', { status: 'rejected' })] })
    expect(pending.report).toMatchObject({ own: 1, fromJob: 0 })
    const legacy = planCarRebase({ car, rules: [rule('s')], jobs: [job('j1', { status: undefined })] })
    expect(legacy.report).toMatchObject({ own: 0, fromJob: 1 })
  })

  it('sin última vez, la base queda vacía y cuenta como propia', () => {
    const plan = planCarRebase({ car, rules: [rule('s', { lastDoneKm: null, lastDoneDate: null })], jobs: [job('j1')] })
    expect(plan.writes[0].data).toEqual({ baseKm: null, baseDate: null })
    expect(plan.report).toMatchObject({ own: 1, fromJob: 0 })
  })

  it('no toca los que ya tienen base, aunque sea null', () => {
    const plan = planCarRebase({ car, rules: [rule('s', { baseKm: null, baseDate: null })], jobs: [] })
    expect(plan.writes).toEqual([])
    expect(plan.report).toMatchObject({ skipped: 1 })
  })

  it('completa los dos campos si falta uno', () => {
    const plan = planCarRebase({ car, rules: [rule('s', { baseKm: 1 })], jobs: [] })
    expect(plan.writes[0].data).toEqual({ baseKm: 40_000, baseDate: '2026-03-12' })
  })

  it('es idempotente: una segunda corrida no escribe nada', () => {
    const input = { car, rules: [rule('s'), rule('vtv', { intervalKm: null, lastDoneKm: null })], jobs: [job('j1')] }
    const first = planCarRebase(input)
    expect(first.writes).toHaveLength(2)
    expect(planCarRebase({ ...input, rules: applied(input.rules, first.writes) }).writes).toEqual([])
  })
})

describe('hasBase', () => {
  it('pide los dos campos, aunque estén en null', () => {
    expect(hasBase({ baseKm: null, baseDate: null })).toBe(true)
    expect(hasBase({ baseDate: '2026-01-01' })).toBe(false)
    expect(hasBase({})).toBe(false)
  })
})

describe('chunk', () => {
  it('parte en tandas de como mucho 450', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i)
    expect(chunk(items).map(b => b.length)).toEqual([450, 450, 100])
    expect(chunk([])).toEqual([])
  })
})
