import { describe, expect, it } from 'vitest'
import { linkedReadingId, packGroups, planCarLinks, readingDateOf } from './link-readings-plan.mjs'

const doc = (id, data) => ({ id, data })

const KM_UPDATED = new Date('2026-05-01T10:00:00')
const CREATED = new Date('2025-01-01T10:00:00')
const NOW = new Date('2026-10-26T10:00:00')

const car = (data = {}) =>
  doc('c1', { ownerUid: 'owner', ownerName: 'Ana', currentKm: 20_000, kmUpdatedAt: KM_UPDATED, createdAt: CREATED, ...data })

const reading = (id, km, data = {}) =>
  doc(id, { carId: 'c1', km, date: new Date('2026-03-01T15:00:00'), source: 'manual', createdBy: 'owner', ...data })

const load = (id, km, data = {}) =>
  doc(id, { carId: 'c1', date: '2026-03-12', km, total: 50_000, createdBy: 'owner', createdByName: 'Ana', ...data })

const job = (id, km, data = {}) =>
  doc(id, { carId: 'c1', date: '2026-04-02', km, title: 'Service', status: 'approved', createdBy: 'owner', createdByName: 'Ana', ...data })

const state = (overrides = {}) => ({
  car: car(),
  readings: [reading('initial', 10_000, { source: 'initial' }), reading('manual', 20_000)],
  fuel: [],
  jobs: [],
  now: NOW,
  ...overrides,
})

const writes = plan => plan.groups.flat()

/** Lo que queda en las lecturas del auto después de escribir los grupos (para simular una segunda corrida). */
function apply(input, groups) {
  const byId = new Map(input.readings.map(r => [r.id, r]))
  for (const w of groups.flat()) {
    const id = w.path.split('/').pop()
    if (w.op === 'delete') byId.delete(id)
    else byId.set(id, doc(id, w.data))
  }
  return { ...input, readings: [...byId.values()] }
}

describe('planCarLinks: km del auto', () => {
  it('un auto con currentKm mayor que sus lecturas recibe la lectura baseline a nombre del dueño', () => {
    const plan = planCarLinks(state({ car: car({ currentKm: 25_000 }) }))
    expect(writes(plan)).toEqual([
      {
        op: 'set',
        path: 'cars/c1/odometer/baseline-c1',
        data: {
          carId: 'c1',
          km: 25_000,
          date: KM_UPDATED,
          source: 'initial',
          sourceId: null,
          createdBy: 'owner',
          createdByName: 'Ana',
        },
      },
    ])
    expect(plan.report.baseline).toBe(1)
  })

  it('un auto sin lecturas recibe la baseline con su km, y sin kmUpdatedAt usa la fecha de alta', () => {
    const plan = planCarLinks(state({ car: car({ kmUpdatedAt: null }), readings: [] }))
    expect(writes(plan)).toHaveLength(1)
    expect(writes(plan)[0].data).toMatchObject({ km: 20_000, date: CREATED, source: 'initial' })
  })

  it('sin kmUpdatedAt ni createdAt usa now', () => {
    const plan = planCarLinks(state({ car: car({ kmUpdatedAt: null, createdAt: null }), readings: [] }))
    expect(writes(plan)[0].data.date).toBe(NOW)
  })

  it('un auto cuyo km ya es el de su lectura más alta no recibe baseline', () => {
    const plan = planCarLinks(state())
    expect(plan.groups).toEqual([])
    expect(plan.report.baseline).toBe(0)
  })
})

describe('planCarLinks: lecturas viejas', () => {
  it('con un solo candidato copia la lectura a {source}-{id} y borra la vieja en el mismo grupo', () => {
    const plan = planCarLinks(
      state({
        readings: [reading('initial', 10_000, { source: 'initial' }), reading('old', 20_000, { source: 'fuel', createdBy: 'member' })],
        fuel: [load('f1', 20_000, { createdBy: 'member', createdByName: 'Beto' }), load('f2', 18_000, { km: 18_000 })],
      }),
    )
    const linkGroup = plan.groups.find(g => g.some(w => w.op === 'delete'))
    expect(linkGroup).toEqual([
      {
        op: 'set',
        path: 'cars/c1/odometer/fuel-f1',
        data: {
          carId: 'c1',
          km: 20_000,
          date: readingDateOf('2026-03-12'),
          source: 'fuel',
          sourceId: 'f1',
          createdBy: 'member',
          createdByName: 'Beto',
        },
      },
      { op: 'delete', path: 'cars/c1/odometer/old' },
    ])
    expect(plan.report.linked).toBe(1)
  })

  it('vincula una lectura de un trabajo aprobado con job-{id}', () => {
    const plan = planCarLinks(
      state({
        readings: [reading('initial', 10_000, { source: 'initial' }), reading('old', 20_000, { source: 'job' })],
        jobs: [job('j1', 20_000)],
      }),
    )
    expect(writes(plan).map(w => [w.op, w.path])).toEqual([
      ['set', 'cars/c1/odometer/job-j1'],
      ['delete', 'cars/c1/odometer/old'],
    ])
    expect(writes(plan)[0].data).toMatchObject({ source: 'job', sourceId: 'j1', date: readingDateOf('2026-04-02') })
  })

  it('con 2 candidatos la deja como está y la informa como ambigua', () => {
    const plan = planCarLinks(
      state({
        readings: [reading('initial', 10_000, { source: 'initial' }), reading('old', 20_000, { source: 'fuel' })],
        fuel: [load('f1', 20_000), load('f2', 20_000)],
      }),
    )
    expect(writes(plan).some(w => w.path.endsWith('/old'))).toBe(false)
    expect(plan.report.linked).toBe(0)
    expect(plan.report.ambiguous).toEqual([
      { path: 'cars/c1/odometer/old', source: 'fuel', km: 20_000, candidates: ['f1', 'f2'] },
    ])
  })

  it('sin candidato (el registro se borró o cambió de km) la deja como está y la informa', () => {
    const plan = planCarLinks(
      state({
        readings: [reading('initial', 10_000, { source: 'initial' }), reading('old', 150_000, { source: 'fuel' })],
        car: car({ currentKm: 150_000 }),
        fuel: [load('f1', 15_000)],
      }),
    )
    expect(writes(plan).some(w => w.path.endsWith('/old'))).toBe(false)
    expect(plan.report.unmatched).toEqual([{ path: 'cars/c1/odometer/old', source: 'fuel', km: 150_000, candidates: [] }])
  })

  it('no cuenta como candidato un trabajo pendiente o rechazado, ni un registro que ya tiene su lectura', () => {
    const plan = planCarLinks(
      state({
        readings: [
          reading('initial', 10_000, { source: 'initial' }),
          reading('old', 20_000, { source: 'job' }),
          reading('job-j3', 20_000, { source: 'job', sourceId: 'j3' }),
        ],
        jobs: [job('j1', 20_000, { status: 'pending' }), job('j2', 20_000, { status: 'rejected' }), job('j3', 20_000)],
      }),
    )
    expect(plan.groups).toEqual([])
    expect(plan.report.unmatched).toHaveLength(1)
  })

  it('no toca las lecturas de alta ni las manuales', () => {
    const plan = planCarLinks(state({ readings: [reading('initial', 10_000, { source: 'initial' }), reading('m', 20_000)] }))
    expect(plan.groups).toEqual([])
    expect(plan.report.unmatched).toEqual([])
  })
})

describe('planCarLinks: registros sin lectura', () => {
  it('una carga y un trabajo aprobado con km y sin lectura reciben la suya, aunque su km sea menor al actual', () => {
    const plan = planCarLinks(state({ fuel: [load('f1', 15_000)], jobs: [job('j1', 18_000)] }))
    expect(writes(plan).map(w => w.path)).toEqual(['cars/c1/odometer/fuel-f1', 'cars/c1/odometer/job-j1'])
    expect(writes(plan)[0].data).toEqual({
      carId: 'c1',
      km: 15_000,
      date: readingDateOf('2026-03-12'),
      source: 'fuel',
      sourceId: 'f1',
      createdBy: 'owner',
      createdByName: 'Ana',
    })
    expect(plan.report.completed).toBe(2)
  })

  it('no crea lectura para un registro sin km ni para un trabajo sin aprobar', () => {
    const plan = planCarLinks(state({ fuel: [load('f1', null)], jobs: [job('j1', 15_000, { status: 'pending' })] }))
    expect(plan.groups).toEqual([])
  })

  it('un registro viejo sin autor queda a nombre del dueño', () => {
    const plan = planCarLinks(state({ fuel: [load('f1', 15_000, { createdBy: null, createdByName: null })] }))
    expect(writes(plan)[0].data).toMatchObject({ createdBy: 'owner', createdByName: 'Ana' })
  })
})

describe('planCarLinks: segunda corrida', () => {
  it('después de escribir todo no hay nada más para escribir', () => {
    const input = state({
      car: car({ currentKm: 30_000 }),
      readings: [
        reading('initial', 10_000, { source: 'initial' }),
        reading('old-f', 20_000, { source: 'fuel' }),
        reading('old-j', 22_000, { source: 'job' }),
        reading('amb', 25_000, { source: 'fuel' }),
        reading('orphan', 99_000, { source: 'fuel' }),
      ],
      fuel: [load('f1', 20_000), load('f2', 25_000), load('f3', 25_000), load('f4', 12_000)],
      jobs: [job('j1', 22_000), job('j2', 23_000)],
    })
    const first = planCarLinks(input)
    expect(first.report).toMatchObject({ baseline: 0, linked: 2, completed: 4 })
    expect(first.report.ambiguous).toHaveLength(1)
    expect(first.report.unmatched).toHaveLength(1)

    const second = planCarLinks(apply(input, first.groups))
    expect(second.groups).toEqual([])
    const third = planCarLinks(apply(apply(input, first.groups), second.groups))
    expect(third.groups).toEqual([])
  })

  it('la baseline de la primera corrida deja el auto sin cambios en la segunda', () => {
    const input = state({ car: car({ currentKm: 25_000 }) })
    const first = planCarLinks(input)
    expect(planCarLinks(apply(input, first.groups)).groups).toEqual([])
  })

  it('no modifica los documentos recibidos', () => {
    const input = state({ readings: [reading('old', 20_000, { source: 'fuel' })], fuel: [load('f1', 20_000)] })
    const copy = structuredClone(input)
    planCarLinks(input)
    expect(input).toEqual(copy)
  })
})

describe('linkedReadingId', () => {
  it('arma el mismo id que la app', () => {
    expect(linkedReadingId('fuel', 'abc')).toBe('fuel-abc')
    expect(linkedReadingId('job', 'abc')).toBe('job-abc')
  })
})

describe('packGroups', () => {
  it('no parte un grupo entre dos tandas', () => {
    const groups = [...Array.from({ length: 224 }, () => ['set', 'delete']), ['set', 'delete'], ['set']]
    const batches = packGroups(groups, 450)
    expect(batches.map(b => b.length)).toEqual([450, 1])
  })
  it('cierra la tanda antes de un grupo que no entra', () => {
    expect(packGroups([['a'], ['b', 'c']], 2).map(b => b.length)).toEqual([1, 2])
  })
  it('sin grupos no da tandas', () => {
    expect(packGroups([])).toEqual([])
  })
})
