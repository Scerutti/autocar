import { describe, expect, it } from 'vitest'
import { chunk, planAccountMigration } from './migrate-cars-plan.mjs'

const doc = (id, data) => ({ id, data })

const source = () => ({
  cars: [doc('c1', { brand: 'Ford', currentKm: 100 }), doc('c2', { brand: 'Fiat', currentKm: 200 })],
  rules: [doc('r1', { carId: 'c1', name: 'Service' }), doc('r2', { carId: 'c2', name: 'VTV' })],
  jobs: [doc('j1', { carId: 'c1', title: 'Frenos' }), doc('j2', { carId: 'c2', title: 'Aceite' })],
  fuel: [doc('f1', { carId: 'c1', total: 50 })],
  odometer: [doc('o1', { carId: 'c1', km: 100 }), doc('o2', { carId: 'c2', km: 200 })],
})

const empty = () => ({ cars: new Map(), children: new Set() })

const plan = (overrides = {}) =>
  planAccountMigration({ uid: 'u1', ownerName: 'Seba', source: source(), existing: empty(), ...overrides })

const byPath = writes => new Map(writes.map(w => [w.path, w.data]))

describe('planAccountMigration', () => {
  it('copia una cuenta con 2 autos y sus hijos, con los mismos ids y los campos nuevos', () => {
    const { writes, report } = plan()
    const w = byPath(writes)
    expect(writes).toHaveLength(9)

    expect(w.get('cars/c1')).toEqual({ brand: 'Ford', currentKm: 100, ownerUid: 'u1', ownerName: 'Seba', members: [] })
    expect(w.get('cars/c2')).toMatchObject({ brand: 'Fiat', ownerUid: 'u1', ownerName: 'Seba', members: [] })

    expect(w.get('cars/c1/rules/r1')).toEqual({ carId: 'c1', name: 'Service' })
    expect(w.get('cars/c2/rules/r2')).toEqual({ carId: 'c2', name: 'VTV' })

    expect(w.get('cars/c1/jobs/j1')).toEqual({
      carId: 'c1',
      title: 'Frenos',
      createdBy: 'u1',
      createdByName: 'Seba',
      status: 'approved',
    })
    expect(w.get('cars/c2/jobs/j2')).toMatchObject({ createdBy: 'u1', createdByName: 'Seba', status: 'approved' })
    expect(w.get('cars/c1/fuel/f1')).toEqual({ carId: 'c1', total: 50, createdBy: 'u1', createdByName: 'Seba' })
    expect(w.get('cars/c1/odometer/o1')).toEqual({ carId: 'c1', km: 100, createdBy: 'u1', createdByName: 'Seba' })
    expect(w.get('cars/c2/odometer/o2')).toMatchObject({ createdBy: 'u1', createdByName: 'Seba' })

    expect(report.cars).toEqual({ copy: 2, skip: 0, conflict: 0 })
    expect(report.jobs).toEqual({ copy: 2, skip: 0, orphan: 0, conflict: 0 })
    expect(report.orphans).toEqual([])
    expect(report.conflicts).toEqual([])
  })

  it('guarda ownerName y createdByName en null cuando la cuenta no tiene nombre', () => {
    const { writes } = plan({ ownerName: null })
    const w = byPath(writes)
    expect(w.get('cars/c1').ownerName).toBeNull()
    expect(w.get('cars/c1/fuel/f1').createdByName).toBeNull()
  })

  it('no modifica los documentos de origen', () => {
    const src = source()
    planAccountMigration({ uid: 'u1', ownerName: 'Seba', source: src, existing: empty() })
    expect(src).toEqual(source())
  })

  it('informa como huérfano un hijo con un carId que no es de la cuenta y no lo escribe', () => {
    const src = source()
    src.jobs.push(doc('j3', { carId: 'otro', title: 'Ajeno' }), doc('j4', { title: 'Sin auto' }))
    const { writes, report } = planAccountMigration({ uid: 'u1', ownerName: 'Seba', source: src, existing: empty() })
    expect(writes.some(w => w.path.endsWith('/j3') || w.path.endsWith('/j4'))).toBe(false)
    expect(report.jobs.orphan).toBe(2)
    expect(report.jobs.copy).toBe(2)
    expect(report.orphans).toEqual([
      { path: 'users/u1/jobs/j3', carId: 'otro' },
      { path: 'users/u1/jobs/j4', carId: null },
    ])
  })

  it('saltea lo que ya existe en el destino y no lo pisa', () => {
    const existing = {
      cars: new Map([['c1', 'u1']]),
      children: new Set(['cars/c1/jobs/j1', 'cars/c1/odometer/o1']),
    }
    const { writes, report } = plan({ existing })
    const paths = writes.map(w => w.path)
    expect(paths).not.toContain('cars/c1')
    expect(paths).not.toContain('cars/c1/jobs/j1')
    expect(paths).not.toContain('cars/c1/odometer/o1')
    expect(paths).toContain('cars/c1/rules/r1')
    expect(paths).toContain('cars/c1/fuel/f1')
    expect(paths).toContain('cars/c2')
    expect(report.cars).toEqual({ copy: 1, skip: 1, conflict: 0 })
    expect(report.jobs).toEqual({ copy: 1, skip: 1, orphan: 0, conflict: 0 })
    expect(report.odometer).toEqual({ copy: 1, skip: 1, orphan: 0, conflict: 0 })
  })

  it('no escribe nada si todo ya existe (segunda corrida)', () => {
    const first = plan()
    const existing = {
      cars: new Map(first.writes.filter(w => w.path.split('/').length === 2).map(w => [w.path.split('/')[1], 'u1'])),
      children: new Set(first.writes.filter(w => w.path.split('/').length > 2).map(w => w.path)),
    }
    expect(plan({ existing }).writes).toEqual([])
  })

  it('informa como conflicto un auto que ya existe con otro dueño, y no copia ni al auto ni a sus hijos', () => {
    const existing = { cars: new Map([['c1', 'otro-uid']]), children: new Set() }
    const { writes, report } = plan({ existing })
    expect(writes.filter(w => w.path.startsWith('cars/c1'))).toEqual([])
    expect(writes.some(w => w.path.startsWith('cars/c2'))).toBe(true)
    expect(report.cars).toEqual({ copy: 1, skip: 0, conflict: 1 })
    expect(report.conflicts).toEqual([{ path: 'cars/c1', ownerUid: 'otro-uid' }])
    expect(report.rules.conflict).toBe(1)
    expect(report.fuel.conflict).toBe(1)
  })
})

describe('chunk', () => {
  it('parte en tandas de como mucho 450', () => {
    const sizes = chunk(Array.from({ length: 1000 }, (_, i) => i)).map(g => g.length)
    expect(sizes).toEqual([450, 450, 100])
  })
  it('una lista vacía no da tandas', () => {
    expect(chunk([])).toEqual([])
  })
})
