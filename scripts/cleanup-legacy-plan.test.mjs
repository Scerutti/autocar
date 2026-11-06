import { describe, expect, it } from 'vitest'
import {
  backupFileName,
  INTENTIONAL_REASONS,
  KEEP_REASONS,
  PROBLEM_REASONS,
  buildBackup,
  compareInstants,
  exitCodeFor,
  isLegacyPath,
  keepGroup,
  summarizeKept,
  summaryLine,
  legacyPath,
  localDay,
  matchReadings,
  planAccountCleanup,
  recheck,
  referencedCarIds,
  sameValue,
  toBackupValue,
  verifyBackup,
} from './cleanup-legacy-plan.mjs'

/** Un `Timestamp` de Firestore de mentira: lo que usa el plan (`toMillis`, `toDate`, `seconds`, `nanoseconds`). */
const ts = iso => {
  const ms = new Date(iso).getTime()
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: (ms % 1000) * 1e6,
    toMillis: () => ms,
    toDate: () => new Date(ms),
  }
}

const doc = (id, data) => ({ id, data })

const legacy = () => ({
  cars: [doc('c1', { brand: 'Ford', model: 'Ka', currentKm: 1000, createdAt: ts('2026-01-10T15:00:00Z') })],
  rules: [doc('r1', { carId: 'c1', name: 'Service', intervalKm: 10000 })],
  jobs: [doc('j1', { carId: 'c1', date: '2026-02-01', km: 900, title: 'Frenos', createdAt: ts('2026-02-01T18:00:00Z') })],
  fuel: [doc('f1', { carId: 'c1', date: '2026-02-05', km: 950, total: 30000, createdAt: ts('2026-02-05T20:00:00Z') })],
  odometer: [
    doc('o1', { carId: 'c1', km: 500, date: ts('2026-01-10T15:00:00Z'), source: 'initial' }),
    doc('o2', { carId: 'c1', km: 950, date: ts('2026-02-05T20:00:00Z'), source: 'fuel' }),
  ],
})

const current = () =>
  new Map([
    [
      'c1',
      {
        car: { brand: 'Ford', model: 'Ka', currentKm: 1200, createdAt: ts('2026-01-10T15:00:00Z'), ownerUid: 'u1', memberUids: [] },
        rules: new Map([['r1', { carId: 'c1', name: 'Service', intervalKm: 10000, baseKm: null }]]),
        jobs: new Map([
          ['j1', { carId: 'c1', date: '2026-02-01', km: 900, title: 'Frenos', createdAt: ts('2026-02-01T18:00:00Z'), status: 'approved' }],
        ]),
        fuel: new Map([['f1', { carId: 'c1', date: '2026-02-05', km: 950, total: 30000, createdAt: ts('2026-02-05T20:00:00Z') }]]),
        odometer: [
          doc('o1', { carId: 'c1', km: 500, date: ts('2026-01-10T15:00:00Z'), source: 'initial' }),
          doc('fuel-f1', { carId: 'c1', km: 950, date: ts('2026-02-05T15:00:00Z'), source: 'fuel', sourceId: 'f1' }),
        ],
      },
    ],
  ])

const plan = (overrides = {}) => planAccountCleanup({ uid: 'u1', legacy: legacy(), current: current(), ...overrides })

const keptBy = report => Object.fromEntries(report.kept.map(k => [k.path, k.reason]))

describe('isLegacyPath', () => {
  it('acepta sólo users/{uid}/{cars|rules|jobs|fuel|odometer}/{id}', () => {
    for (const name of ['cars', 'rules', 'jobs', 'fuel', 'odometer']) expect(isLegacyPath(`users/u1/${name}/x`)).toBe(true)
  })

  it('rechaza todo lo demás', () => {
    for (const path of [
      'cars/c1',
      'cars/c1/jobs/j1',
      'users/u1',
      'users/u1/achievements/a1',
      'users/u1/pushSubscriptions/abc',
      'users/u1/ruleNotices/r1',
      'users/u1/cars/c1/jobs/j1',
      'users/u1/cars/',
      'invites/c1_x',
      'allowlist/a@b.com',
      null,
    ]) {
      expect(isLegacyPath(path)).toBe(false)
    }
  })

  it('legacyPath tira error si no da una ruta vieja', () => {
    expect(legacyPath('u1', 'jobs', 'j1')).toBe('users/u1/jobs/j1')
    expect(() => legacyPath('u1', 'achievements', 'a1')).toThrow()
    expect(() => legacyPath('u1', 'jobs', 'a/b')).toThrow()
  })
})

describe('planAccountCleanup', () => {
  it('borra todo lo que tiene copia probada: primero los hijos y al final el auto', () => {
    const { deletes, report } = plan()
    expect(deletes.map(d => d.path)).toEqual([
      'users/u1/odometer/o1',
      'users/u1/odometer/o2',
      'users/u1/fuel/f1',
      'users/u1/jobs/j1',
      'users/u1/rules/r1',
      'users/u1/cars/c1',
    ])
    expect(deletes.at(-1).children).toEqual(deletes.slice(0, -1).map(d => d.path))
    expect(report.kept).toEqual([])
    expect(report.deleted.find(d => d.path === 'users/u1/odometer/o2').via).toBe('cars/c1/odometer/fuel-f1 (day)')
  })

  it('sólo devuelve rutas viejas para borrar, nunca de cars/ ni de users/{uid}', () => {
    const { deletes } = plan()
    expect(deletes.every(d => isLegacyPath(d.path))).toBe(true)
    expect(deletes.some(d => d.path.startsWith('cars/'))).toBe(false)
  })

  it('guarda en cada borrado los datos del documento viejo, para el respaldo', () => {
    const { deletes } = plan()
    expect(deletes.find(d => d.path === 'users/u1/jobs/j1').data).toMatchObject({ title: 'Frenos', km: 900 })
  })

  it('una segunda corrida (sin documentos viejos) no borra nada', () => {
    const empty = { cars: [], rules: [], jobs: [], fuel: [], odometer: [] }
    const { deletes, report } = plan({ legacy: empty })
    expect(deletes).toEqual([])
    expect(report).toEqual({ uid: 'u1', deleted: [], kept: [] })
  })

  it('no modifica lo que recibe', () => {
    const src = legacy()
    const before = JSON.stringify(src)
    planAccountCleanup({ uid: 'u1', legacy: src, current: current() })
    expect(JSON.stringify(src)).toBe(before)
  })

  it('deja un hijo sin copia y, con él, el auto', () => {
    const cur = current()
    cur.get('c1').jobs.delete('j1')
    const { deletes, report } = plan({ current: cur })
    expect(keptBy(report)).toEqual({ 'users/u1/jobs/j1': 'no-copy', 'users/u1/cars/c1': 'child-kept' })
    expect(deletes.map(d => d.path)).not.toContain('users/u1/cars/c1')
    expect(deletes.map(d => d.path)).toContain('users/u1/fuel/f1')
  })

  it('un id igual no alcanza: si cambió createdAt, el trabajo queda', () => {
    const cur = current()
    cur.get('c1').jobs.get('j1').createdAt = ts('2026-03-01T00:00:00Z')
    const { report } = plan({ current: cur })
    expect(report.kept).toContainEqual({ path: 'users/u1/jobs/j1', carId: 'c1', reason: 'copy-differs', detail: 'createdAt' })
  })

  it('un trabajo o una carga editados en la app nueva (mismo createdAt y carId) se dan por copiados', () => {
    const cur = current()
    Object.assign(cur.get('c1').jobs.get('j1'), { title: 'Frenos y pastillas', km: 910, date: '2026-02-02' })
    cur.get('c1').fuel.get('f1').total = 31000
    expect(plan({ current: cur }).report.kept).toEqual([])
  })

  it('compara el carId: una copia de otro auto no cuenta', () => {
    const cur = current()
    cur.get('c1').rules.get('r1').carId = 'c2'
    expect(keptBy(plan({ current: cur }).report)['users/u1/rules/r1']).toBe('copy-differs')
  })

  it('un mantenimiento renombrado queda (no tiene createdAt para compararlo)', () => {
    const cur = current()
    cur.get('c1').rules.get('r1').name = 'Service 10.000'
    expect(keptBy(plan({ current: cur }).report)['users/u1/rules/r1']).toBe('copy-differs')
  })

  it('sin createdAt, el trabajo se compara por carId, fecha y título', () => {
    const src = legacy()
    delete src.jobs[0].data.createdAt
    const cur = current()
    delete cur.get('c1').jobs.get('j1').createdAt
    expect(plan({ legacy: src, current: cur }).report.kept).toEqual([])
    cur.get('c1').jobs.get('j1').title = 'Otro'
    expect(keptBy(plan({ legacy: src, current: cur }).report)['users/u1/jobs/j1']).toBe('copy-differs')
  })

  it('deja todo si el auto no existe en cars/', () => {
    const { deletes, report } = plan({ current: new Map() })
    expect(deletes).toEqual([])
    expect(new Set(report.kept.map(k => k.reason))).toEqual(new Set(['car-missing']))
    expect(report.kept).toHaveLength(6)
  })

  it('deja todo si el auto está marcado como borrado en cars/', () => {
    const cur = current()
    cur.get('c1').car.deletedAt = ts('2026-10-01T00:00:00Z')
    const { deletes, report } = plan({ current: cur })
    expect(deletes).toEqual([])
    expect(new Set(report.kept.map(k => k.reason))).toEqual(new Set(['car-deleted']))
  })

  it('deja el auto si su createdAt no coincide, o si no tiene', () => {
    const cur = current()
    cur.get('c1').car.createdAt = ts('2025-01-01T00:00:00Z')
    expect(keptBy(plan({ current: cur }).report)['users/u1/cars/c1']).toBe('copy-differs')
    const src = legacy()
    delete src.cars[0].data.createdAt
    expect(keptBy(plan({ legacy: src }).report)['users/u1/cars/c1']).toBe('no-fingerprint')
  })

  it('deja un auto viejo que tiene subcolecciones', () => {
    const { deletes, report } = plan({ legacyCarsWithChildren: new Set(['c1']) })
    expect(keptBy(report)).toEqual({ 'users/u1/cars/c1': 'has-subcollections' })
    expect(deletes).toHaveLength(5)
  })

  it('deja un hijo sin carId válido o de un auto que no es viejo de la cuenta (huérfano)', () => {
    const src = legacy()
    src.fuel.push(doc('f9', { total: 1 }), doc('f8', { carId: '../x', total: 1 }))
    src.rules.push(doc('r2', { carId: 'c2', name: 'VTV' }))
    const cur = current()
    cur.set('c2', {
      car: { createdAt: ts('2026-01-01T00:00:00Z'), ownerUid: 'u1' },
      rules: new Map([['r2', { carId: 'c2', name: 'VTV' }]]),
      jobs: new Map(),
      fuel: new Map(),
      odometer: [],
    })
    const { deletes, report } = plan({ legacy: src, current: cur })
    expect(keptBy(report)).toEqual({
      'users/u1/fuel/f9': 'no-car-id',
      'users/u1/fuel/f8': 'no-car-id',
      'users/u1/rules/r2': 'orphan',
    })
    expect(deletes.map(d => d.path)).toContain('users/u1/cars/c1')
  })

  it('deja todo si el auto nuevo es de otra cuenta', () => {
    const cur = current()
    cur.get('c1').car.ownerUid = 'otra'
    const { deletes, report } = plan({ current: cur })
    expect(deletes).toEqual([])
    expect(new Set(report.kept.map(k => k.reason))).toEqual(new Set(['conflict']))
  })

  it('borra si la cuenta es miembro del auto nuevo (le pasó el auto a otro)', () => {
    const cur = current()
    Object.assign(cur.get('c1').car, { ownerUid: 'otra', memberUids: ['u1'] })
    expect(plan({ current: cur }).report.kept).toEqual([])
  })

  it('deja un documento viejo editado después de crearse su copia (legacy-newer), y con él el auto', () => {
    const src = legacy()
    src.jobs[0].updateTime = ts('2026-05-01T00:00:00Z')
    src.odometer[1].updateTime = ts('2026-02-05T20:00:00Z')
    const cur = current()
    cur.get('c1').createTimes = new Map([
      ['cars/c1/jobs/j1', ts('2026-04-01T00:00:00Z')],
      ['cars/c1/odometer/fuel-f1', ts('2026-04-01T00:00:00Z')],
    ])
    const { deletes, report } = plan({ legacy: src, current: cur })
    expect(keptBy(report)).toEqual({ 'users/u1/jobs/j1': 'legacy-newer', 'users/u1/cars/c1': 'child-kept' })
    expect(deletes.map(d => d.path)).toContain('users/u1/odometer/o2')
  })

  it('deja el auto viejo editado después de crearse cars/{carId}', () => {
    const src = legacy()
    src.cars[0].updateTime = ts('2026-06-01T00:00:00Z')
    const cur = current()
    cur.get('c1').createTimes = new Map([['cars/c1', ts('2026-05-31T23:59:59Z')]])
    expect(keptBy(plan({ legacy: src, current: cur }).report)).toEqual({ 'users/u1/cars/c1': 'legacy-newer' })
  })

  it('cada borrado trae la ruta de su copia y la del auto nuevo, para volver a leerlas antes de borrar', () => {
    const { deletes } = plan()
    const byPath = new Map(deletes.map(d => [d.path, d]))
    expect(byPath.get('users/u1/odometer/o2')).toMatchObject({ copyPath: 'cars/c1/odometer/fuel-f1', carPath: 'cars/c1' })
    expect(byPath.get('users/u1/jobs/j1')).toMatchObject({ copyPath: 'cars/c1/jobs/j1', carPath: 'cars/c1' })
    expect(byPath.get('users/u1/cars/c1')).toMatchObject({ copyPath: 'cars/c1', carPath: 'cars/c1' })
  })

  it('dos corridas seguidas: la segunda no borra nada que no tenga su propia copia', () => {
    const odo = (id, km, iso, extra = {}) => doc(id, { carId: 'c1', km, date: ts(iso), source: 'manual', ...extra })
    const src = legacy()
    src.odometer = [
      odo('m1', 500, '2026-01-10T15:00:00Z'),
      odo('m2', 500, '2026-01-10T16:00:00Z'),
      odo('a1', 950, '2026-02-05T20:00:00Z', { source: 'fuel' }),
      odo('a2', 950, '2026-02-05T21:00:00Z', { source: 'fuel' }),
      odo('b1', 990, '2026-02-09T20:00:00Z', { source: 'fuel' }),
    ]
    const cur = current()
    cur.get('c1').odometer = [
      odo('m1', 500, '2026-01-10T15:00:00Z'),
      odo('fuel-f1', 950, '2026-02-05T15:00:00Z', { source: 'fuel', sourceId: 'f1' }),
      odo('fuel-f2', 990, '2026-02-09T15:00:00Z', { source: 'fuel', sourceId: 'f2' }),
    ]

    const first = plan({ legacy: src, current: cur })
    const removed = new Set(first.deletes.map(d => d.path))
    expect([...removed].filter(p => p.includes('/odometer/')).sort()).toEqual(['users/u1/odometer/b1', 'users/u1/odometer/m1'])
    expect(keptBy(first.report)).toMatchObject({
      'users/u1/odometer/m2': 'no-copy',
      'users/u1/odometer/a1': 'ambiguous',
      'users/u1/odometer/a2': 'ambiguous',
    })

    const after = Object.fromEntries(
      Object.entries(src).map(([name, docs]) => [name, docs.filter(d => !removed.has(`users/u1/${name}/${d.id}`))]),
    )
    const second = plan({ legacy: after, current: cur })
    expect(second.deletes).toEqual([])
    expect(keptBy(second.report)).toMatchObject({
      'users/u1/odometer/m2': 'no-copy',
      'users/u1/odometer/a1': 'ambiguous',
      'users/u1/odometer/a2': 'ambiguous',
    })
  })
})

describe('matchReadings', () => {
  const reading = (id, km, iso, extra = {}) => doc(id, { carId: 'c1', km, date: ts(iso), source: 'manual', ...extra })
  const linked = (id, km, iso, source = 'fuel') => reading(id, km, iso, { source, sourceId: id.split('-').slice(1).join('-') })

  it('mismo id: tiene que tener el mismo km y la misma fecha', () => {
    const r = reading('o1', 100, '2026-01-01T12:00:00Z')
    expect(matchReadings({ legacy: [r], current: [r] }).get('o1')).toEqual({ copy: 'o1', via: 'id' })
    const other = reading('o1', 101, '2026-01-01T12:00:00Z')
    expect(matchReadings({ legacy: [r], current: [other] }).get('o1')).toEqual({ reason: 'copy-differs', detail: 'km' })
  })

  it('con el mismo id distinto no busca otra copia por día', () => {
    const r = reading('o1', 100, '2026-01-01T12:00:00Z', { source: 'fuel' })
    const current = [reading('o1', 101, '2026-01-01T12:00:00Z', { source: 'fuel' }), linked('fuel-f1', 100, '2026-01-01T15:00:00Z')]
    expect(matchReadings({ legacy: [r], current }).get('o1').reason).toBe('copy-differs')
  })

  it('por sourceId: la lectura {source}-{sourceId} con el mismo km', () => {
    const r = reading('o1', 100, '2026-01-01T12:00:00Z', { source: 'job', sourceId: 'j1' })
    expect(matchReadings({ legacy: [r], current: [linked('job-j1', 100, '2026-03-01T12:00:00Z', 'job')] }).get('o1')).toEqual({
      copy: 'job-j1',
      via: 'sourceId',
    })
    expect(matchReadings({ legacy: [r], current: [linked('job-j1', 120, '2026-01-01T12:00:00Z', 'job')] }).get('o1').reason).toBe('no-copy')
  })

  it('por día: una lectura vinculada del mismo km, origen y día local', () => {
    const r = reading('o1', 100, '2026-01-01T20:00:00Z', { source: 'fuel' })
    expect(matchReadings({ legacy: [r], current: [linked('fuel-f1', 100, '2026-01-01T15:00:00Z')] }).get('o1')).toEqual({
      copy: 'fuel-f1',
      via: 'day',
    })
  })

  it('por día sólo valen las vinculadas: una lectura manual o sin sourceId no es candidata', () => {
    const manual = reading('o1', 100, '2026-01-01T20:00:00Z')
    expect(matchReadings({ legacy: [manual], current: [reading('n1', 100, '2026-01-01T13:00:00Z')] }).get('o1').reason).toBe('no-copy')
    const fuel = reading('o1', 100, '2026-01-01T20:00:00Z', { source: 'fuel' })
    const unlinked = reading('n1', 100, '2026-01-01T13:00:00Z', { source: 'fuel' })
    expect(matchReadings({ legacy: [fuel], current: [unlinked] }).get('o1').reason).toBe('no-copy')
  })

  it('el día es el de Argentina: 01:00 UTC todavía es el día anterior', () => {
    expect(localDay(ts('2026-03-10T01:00:00Z'))).toBe('2026-03-09')
    const r = reading('o1', 100, '2026-03-10T01:00:00Z', { source: 'fuel' })
    expect(matchReadings({ legacy: [r], current: [linked('fuel-f1', 100, '2026-03-09T15:00:00Z')] }).get('o1').copy).toBe('fuel-f1')
    expect(matchReadings({ legacy: [r], current: [linked('fuel-f1', 100, '2026-03-10T15:00:00Z')] }).get('o1').reason).toBe('no-copy')
  })

  it('otro origen u otro km no cuentan', () => {
    const r = reading('o1', 100, '2026-01-01T20:00:00Z', { source: 'fuel' })
    const current = [linked('job-j1', 100, '2026-01-01T13:00:00Z', 'job'), linked('fuel-f1', 99, '2026-01-01T13:00:00Z')]
    expect(matchReadings({ legacy: [r], current }).get('o1').reason).toBe('no-copy')
  })

  it('más de un candidato: ambigua, no se borra', () => {
    const r = reading('o1', 100, '2026-01-01T20:00:00Z', { source: 'fuel' })
    const current = [linked('fuel-f1', 100, '2026-01-01T13:00:00Z'), linked('fuel-f2', 100, '2026-01-01T14:00:00Z')]
    expect(matchReadings({ legacy: [r], current }).get('o1')).toEqual({ reason: 'ambiguous', detail: 'fuel-f1, fuel-f2' })
  })

  it('una lectura nueva que le sirve a dos viejas deja a las dos (ambiguas)', () => {
    const legacyReadings = [
      reading('o1', 100, '2026-01-01T20:00:00Z', { source: 'fuel' }),
      reading('o2', 100, '2026-01-01T21:00:00Z', { source: 'fuel' }),
    ]
    const result = matchReadings({ legacy: legacyReadings, current: [linked('fuel-f1', 100, '2026-01-01T13:00:00Z')] })
    expect(result.get('o1')).toEqual({ reason: 'ambiguous', detail: 'fuel-f1 también le sirve a o2' })
    expect(result.get('o2')).toEqual({ reason: 'ambiguous', detail: 'fuel-f1 también le sirve a o1' })
  })

  it('cuenta también la copia por sourceId: si otra vieja la toma por día, quedan las dos', () => {
    const legacyReadings = [
      reading('o1', 100, '2026-01-01T20:00:00Z', { source: 'fuel', sourceId: 'f1' }),
      reading('o2', 100, '2026-01-01T21:00:00Z', { source: 'fuel' }),
    ]
    const result = matchReadings({ legacy: legacyReadings, current: [linked('fuel-f1', 100, '2026-01-01T13:00:00Z')] })
    expect(result.get('o1').reason).toBe('ambiguous')
    expect(result.get('o2').reason).toBe('ambiguous')
  })

  it('una lectura movida por link-readings a la fecha de la carga se encuentra por el createdAt de la carga', () => {
    const r = reading('o1', 950, '2026-02-07T20:00:00Z', { source: 'fuel' })
    const copy = linked('fuel-f1', 950, '2026-02-05T15:00:00Z')
    const records = { fuel: new Map([['f1', { createdAt: ts('2026-02-07T20:00:00Z') }]]), jobs: new Map() }
    expect(matchReadings({ legacy: [r], current: [copy], records }).get('o1')).toEqual({ copy: 'fuel-f1', via: 'day' })
    const otherDay = { fuel: new Map([['f1', { createdAt: ts('2026-02-08T20:00:00Z') }]]), jobs: new Map() }
    expect(matchReadings({ legacy: [r], current: [copy], records: otherDay }).get('o1').reason).toBe('no-copy')
  })

  it('sin km o sin fecha no se puede comparar', () => {
    const r = doc('o1', { carId: 'c1', km: null, date: ts('2026-01-01T20:00:00Z'), source: 'fuel' })
    expect(matchReadings({ legacy: [r], current: [] }).get('o1').reason).toBe('no-fingerprint')
  })
})

describe('referencedCarIds', () => {
  it('lee sólo los autos viejos de la cuenta, sin ids inválidos', () => {
    const src = legacy()
    src.cars.push(doc('a/b', {}))
    src.jobs.push(doc('j2', { carId: 'c2' }))
    expect(referencedCarIds(src)).toEqual(['c1'])
  })
})

describe('sameValue y compareInstants', () => {
  it('null y ausente son iguales; los instantes se comparan por milisegundo', () => {
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue(ts('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(true)
    expect(sameValue(ts('2026-01-01T00:00:00Z'), ts('2026-01-01T00:00:01Z'))).toBe(false)
    expect(sameValue('a', null)).toBe(false)
    expect(sameValue(0, null)).toBe(false)
  })

  it('compareInstants compara al nanosegundo y da null si falta uno', () => {
    expect(compareInstants({ seconds: 10, nanoseconds: 2 }, { seconds: 10, nanoseconds: 1 })).toBeGreaterThan(0)
    expect(compareInstants({ seconds: 10, nanoseconds: 1 }, { seconds: 10, nanoseconds: 1 })).toBe(0)
    expect(compareInstants(ts('2026-01-01T00:00:00Z'), ts('2026-01-02T00:00:00Z'))).toBeLessThan(0)
    expect(compareInstants(null, ts('2026-01-01T00:00:00Z'))).toBeNull()
  })
})

describe('recheck', () => {
  const t = { seconds: 10, nanoseconds: 0 }
  const fresh = (over = {}) => ({
    legacy: { exists: true, updateTime: t },
    copy: { exists: true, updateTime: t },
    car: { exists: true, updateTime: t },
    ...over,
  })
  const expected = { legacy: t, copy: t, car: t }

  it('deja borrar si nada cambió', () => {
    expect(recheck({ expected, fresh: fresh() })).toBeNull()
  })

  it('no deja borrar si la copia, el auto o el viejo ya no están o cambiaron', () => {
    expect(recheck({ expected, fresh: fresh({ copy: { exists: false, updateTime: null } }) })).toBe('copy: ya no existe')
    expect(recheck({ expected, fresh: fresh({ copy: { exists: true, updateTime: { seconds: 11, nanoseconds: 0 } } }) })).toBe(
      'copy: cambió desde que se leyó',
    )
    expect(recheck({ expected, fresh: fresh({ car: { exists: false, updateTime: null } }) })).toBe('car: ya no existe')
    expect(recheck({ expected, fresh: fresh({ legacy: { exists: true, updateTime: { seconds: 10, nanoseconds: 1 } } }) })).toBe(
      'legacy: cambió desde que se leyó',
    )
    expect(recheck({ expected: { ...expected, copy: undefined }, fresh: fresh() })).toBe('copy: cambió desde que se leyó')
  })
})

describe('respaldo', () => {
  it('guarda los instantes con fecha ISO, segundos y nanosegundos, y el resto tal cual', () => {
    expect(toBackupValue({ a: 1, b: 'x', c: null, d: [ts('2026-01-01T00:00:00.250Z')], e: { f: true } })).toEqual({
      a: 1,
      b: 'x',
      c: null,
      d: [{ __time: '2026-01-01T00:00:00.250Z', seconds: 1767225600, nanoseconds: 250000000 }],
      e: { f: true },
    })
  })

  it('tira error con un número no finito, que JSON guardaría como null', () => {
    expect(() => toBackupValue({ km: Number.NaN })).toThrow()
    expect(() => buildBackup([{ path: 'users/u1/fuel/f1', data: { total: Infinity } }])).toThrow('users/u1/fuel/f1')
  })

  it('arma el respaldo con la ruta y los datos de cada documento que se borra, y sobrevive a JSON', () => {
    const { deletes } = plan()
    const backup = JSON.parse(JSON.stringify(buildBackup(deletes, new Date('2026-11-06T10:00:00Z'))))
    expect(backup.count).toBe(6)
    expect(backup.docs.map(d => d.path)).toEqual(deletes.map(d => d.path))
    expect(backup.docs.find(d => d.path === 'users/u1/cars/c1').data.createdAt.__time).toBe('2026-01-10T15:00:00.000Z')
  })

  it('verifyBackup acepta el respaldo releído y rechaza uno con otros datos, otra ruta o incompleto', () => {
    const { deletes } = plan()
    const text = JSON.stringify(buildBackup(deletes), null, 2)
    expect(verifyBackup(text, deletes)).toBeNull()

    const changed = JSON.parse(text)
    changed.docs[2].data.total = 1
    expect(verifyBackup(JSON.stringify(changed), deletes)).toBe('los datos de users/u1/fuel/f1 no coinciden')

    const missingField = JSON.parse(text)
    delete missingField.docs[3].data.title
    expect(verifyBackup(JSON.stringify(missingField), deletes)).toBe('los datos de users/u1/jobs/j1 no coinciden')

    const otherPath = JSON.parse(text)
    otherPath.docs[0].path = 'users/u1/odometer/x'
    expect(verifyBackup(JSON.stringify(otherPath), deletes)).toMatch(/no es users\/u1\/odometer\/o1/)

    const short = JSON.parse(text)
    short.docs.pop()
    expect(verifyBackup(JSON.stringify(short), deletes)).toBe('el respaldo no tiene la misma cantidad de documentos')

    expect(verifyBackup(text.slice(0, 50), deletes)).toBe('el respaldo no es JSON válido')
  })

  it('el nombre del archivo no tiene caracteres que Windows no acepta', () => {
    expect(backupFileName(new Date('2026-11-06T10:20:30.400Z'))).toBe('legacy-backup-2026-11-06T10-20-30-400Z.json')
  })
})

describe('grupos de lo que queda', () => {
  const k = reason => ({ path: `users/u1/jobs/${reason}`, carId: 'c1', reason, detail: null })

  it('cada motivo está en un solo grupo y todos los motivos tienen grupo', () => {
    expect(INTENTIONAL_REASONS.filter(r => PROBLEM_REASONS.includes(r))).toEqual([])
    expect([...INTENTIONAL_REASONS, ...PROBLEM_REASONS].sort()).toEqual(Object.keys(KEEP_REASONS).sort())
  })

  it('lo que se borró o editó en la app queda a propósito; lo ambiguo y lo de otra cuenta es un problema', () => {
    for (const r of ['car-missing', 'car-deleted', 'no-copy', 'copy-differs', 'legacy-newer', 'orphan', 'no-car-id', 'child-kept']) {
      expect(keepGroup(r)).toBe('intentional')
    }
    for (const r of ['ambiguous', 'conflict', 'no-fingerprint', 'has-subcollections', 'algo-nuevo']) expect(keepGroup(r)).toBe('problem')
  })

  it('cuenta por grupo y por motivo', () => {
    expect(summarizeKept([k('no-copy'), k('no-copy'), k('car-deleted'), k('ambiguous')])).toEqual({
      intentional: { total: 3, byReason: { 'no-copy': 2, 'car-deleted': 1 } },
      problem: { total: 1, byReason: { ambiguous: 1 } },
    })
  })

  it('código 0 si sólo quedó lo que es a propósito; 1 con cualquier problema', () => {
    expect(exitCodeFor({ kept: [] })).toBe(0)
    expect(exitCodeFor({ kept: [k('no-copy'), k('legacy-newer'), k('child-kept')] })).toBe(0)
    expect(exitCodeFor({ kept: [k('no-copy'), k('ambiguous')] })).toBe(1)
    expect(exitCodeFor({ kept: [k('conflict')] })).toBe(1)
    expect(exitCodeFor({ kept: [], skipped: 1 })).toBe(1)
    expect(exitCodeFor({ kept: [], errors: 1 })).toBe(1)
    expect(exitCodeFor({ kept: [], backupFailed: true })).toBe(1)
  })

  it('el plan de un auto borrado en la app sólo deja cosas a propósito (código 0)', () => {
    expect(exitCodeFor({ kept: plan({ current: new Map() }).report.kept })).toBe(0)
    const cur = current()
    cur.get('c1').car.ownerUid = 'otra'
    expect(exitCodeFor({ kept: plan({ current: cur }).report.kept })).toBe(1)
  })

  it('línea de resumen: una segunda corrida sin cambios dice 0 borrados y 0 problemas', () => {
    expect(summaryLine({ apply: true, deleted: 0, kept: [k('no-copy')] })).toBe(
      'Resumen: 0 borrados, 1 quedaron a propósito, 0 problemas.',
    )
    expect(summaryLine({ apply: false, deleted: 5, kept: [k('ambiguous')], skipped: 0 })).toBe(
      'Resumen: 5 se borrarían, 0 quedaron a propósito, 1 problema.',
    )
    expect(summaryLine({ apply: true, deleted: 2, kept: [], skipped: 1, errors: 1 })).toBe(
      'Resumen: 2 borrados, 0 quedaron a propósito, 2 problemas.',
    )
  })
})
