import { describe, expect, it } from 'vitest'
import {
  backupFileName,
  buildBackup,
  isLegacyPath,
  legacyPath,
  localDay,
  matchReadings,
  planAccountCleanup,
  referencedCarIds,
  sameValue,
  toBackupValue,
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

  it('deja un hijo sin carId válido, y borra uno de otro auto que sí tiene copia', () => {
    const src = legacy()
    src.fuel.push(doc('f9', { total: 1 }), doc('f8', { carId: '../x', total: 1 }))
    src.rules.push(doc('r2', { carId: 'c2', name: 'VTV' }))
    const cur = current()
    cur.set('c2', {
      car: { createdAt: ts('2026-01-01T00:00:00Z') },
      rules: new Map([['r2', { carId: 'c2', name: 'VTV' }]]),
      jobs: new Map(),
      fuel: new Map(),
      odometer: [],
    })
    const { deletes, report } = plan({ legacy: src, current: cur })
    expect(keptBy(report)).toEqual({ 'users/u1/fuel/f9': 'no-car-id', 'users/u1/fuel/f8': 'no-car-id' })
    expect(deletes.map(d => d.path)).toContain('users/u1/rules/r2')
    expect(deletes.map(d => d.path)).toContain('users/u1/cars/c1')
  })
})

describe('matchReadings', () => {
  const reading = (id, km, iso, extra = {}) => doc(id, { carId: 'c1', km, date: ts(iso), source: 'manual', ...extra })

  it('mismo id: tiene que tener el mismo km y la misma fecha', () => {
    const r = reading('o1', 100, '2026-01-01T12:00:00Z')
    expect(matchReadings({ legacy: [r], current: [r] }).get('o1')).toEqual({ copy: 'o1', via: 'id' })
    const other = reading('o1', 101, '2026-01-01T12:00:00Z')
    expect(matchReadings({ legacy: [r], current: [other] }).get('o1')).toEqual({ reason: 'copy-differs', detail: 'km' })
  })

  it('con el mismo id distinto no busca otra copia por día', () => {
    const r = reading('o1', 100, '2026-01-01T12:00:00Z')
    const current = [reading('o1', 101, '2026-01-01T12:00:00Z'), reading('x', 100, '2026-01-01T13:00:00Z')]
    expect(matchReadings({ legacy: [r], current }).get('o1').reason).toBe('copy-differs')
  })

  it('por sourceId: la lectura {source}-{sourceId} con el mismo km', () => {
    const r = reading('o1', 100, '2026-01-01T12:00:00Z', { source: 'job', sourceId: 'j1' })
    const copy = reading('job-j1', 100, '2026-03-01T12:00:00Z', { source: 'job', sourceId: 'j1' })
    expect(matchReadings({ legacy: [r], current: [copy] }).get('o1')).toEqual({ copy: 'job-j1', via: 'sourceId' })
    const wrong = reading('job-j1', 120, '2026-01-01T12:00:00Z', { source: 'job', sourceId: 'j1' })
    expect(matchReadings({ legacy: [r], current: [wrong] }).get('o1').reason).toBe('no-copy')
  })

  it('por día: mismo km, mismo origen y mismo día local', () => {
    const r = reading('o1', 100, '2026-01-01T20:00:00Z')
    const copy = reading('n1', 100, '2026-01-01T13:00:00Z')
    expect(matchReadings({ legacy: [r], current: [copy] }).get('o1')).toEqual({ copy: 'n1', via: 'day' })
  })

  it('el día es el de Argentina: 01:00 UTC todavía es el día anterior', () => {
    expect(localDay(ts('2026-03-10T01:00:00Z'))).toBe('2026-03-09')
    const r = reading('o1', 100, '2026-03-10T01:00:00Z')
    expect(matchReadings({ legacy: [r], current: [reading('n1', 100, '2026-03-09T15:00:00Z')] }).get('o1').copy).toBe('n1')
    expect(matchReadings({ legacy: [r], current: [reading('n1', 100, '2026-03-10T15:00:00Z')] }).get('o1').reason).toBe('no-copy')
  })

  it('otro origen u otro km no cuentan', () => {
    const r = reading('o1', 100, '2026-01-01T20:00:00Z', { source: 'fuel' })
    const current = [reading('n1', 100, '2026-01-01T13:00:00Z'), reading('n2', 99, '2026-01-01T13:00:00Z', { source: 'fuel' })]
    expect(matchReadings({ legacy: [r], current }).get('o1').reason).toBe('no-copy')
  })

  it('una vieja sin source cuenta como manual', () => {
    const r = doc('o1', { carId: 'c1', km: 100, date: ts('2026-01-01T20:00:00Z') })
    expect(matchReadings({ legacy: [r], current: [reading('n1', 100, '2026-01-01T13:00:00Z')] }).get('o1').copy).toBe('n1')
  })

  it('más de un candidato: ambigua, no se borra', () => {
    const r = reading('o1', 100, '2026-01-01T20:00:00Z')
    const current = [reading('n1', 100, '2026-01-01T13:00:00Z'), reading('n2', 100, '2026-01-01T14:00:00Z')]
    expect(matchReadings({ legacy: [r], current }).get('o1')).toEqual({ reason: 'ambiguous', detail: 'n1, n2' })
  })

  it('cada lectura nueva es la copia de una sola vieja', () => {
    const legacyReadings = [reading('o1', 100, '2026-01-01T20:00:00Z'), reading('o2', 100, '2026-01-01T21:00:00Z')]
    const result = matchReadings({ legacy: legacyReadings, current: [reading('n1', 100, '2026-01-01T13:00:00Z')] })
    expect(result.get('o1')).toEqual({ copy: 'n1', via: 'day' })
    expect(result.get('o2').reason).toBe('no-copy')
  })

  it('una lectura nueva con el id de una vieja no es candidata de otra', () => {
    const legacyReadings = [reading('o1', 100, '2026-01-01T20:00:00Z'), reading('o2', 100, '2026-01-01T21:00:00Z')]
    const current = [reading('o2', 101, '2026-01-01T21:00:00Z')]
    const result = matchReadings({ legacy: legacyReadings, current })
    expect(result.get('o1').reason).toBe('no-copy')
    expect(result.get('o2').reason).toBe('copy-differs')
  })

  it('una lectura movida por link-readings a la fecha de la carga se encuentra por el createdAt de la carga', () => {
    const r = reading('o1', 950, '2026-02-07T20:00:00Z', { source: 'fuel' })
    const copy = reading('fuel-f1', 950, '2026-02-05T15:00:00Z', { source: 'fuel', sourceId: 'f1' })
    const records = { fuel: new Map([['f1', { createdAt: ts('2026-02-07T20:00:00Z') }]]), jobs: new Map() }
    expect(matchReadings({ legacy: [r], current: [copy], records }).get('o1')).toEqual({ copy: 'fuel-f1', via: 'day' })
    const otherDay = { fuel: new Map([['f1', { createdAt: ts('2026-02-08T20:00:00Z') }]]), jobs: new Map() }
    expect(matchReadings({ legacy: [r], current: [copy], records: otherDay }).get('o1').reason).toBe('no-copy')
  })

  it('sin km o sin fecha no se puede comparar', () => {
    const r = doc('o1', { carId: 'c1', km: null, date: ts('2026-01-01T20:00:00Z') })
    expect(matchReadings({ legacy: [r], current: [] }).get('o1').reason).toBe('no-fingerprint')
  })
})

describe('referencedCarIds', () => {
  it('junta los autos viejos y los carId de los hijos, sin ids inválidos', () => {
    const src = legacy()
    src.jobs.push(doc('j2', { carId: 'c2' }), doc('j3', { carId: 'a/b' }), doc('j4', {}))
    expect(referencedCarIds(src)).toEqual(['c1', 'c2'])
  })
})

describe('sameValue', () => {
  it('null y ausente son iguales; los instantes se comparan por milisegundo', () => {
    expect(sameValue(undefined, null)).toBe(true)
    expect(sameValue(ts('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'))).toBe(true)
    expect(sameValue(ts('2026-01-01T00:00:00Z'), ts('2026-01-01T00:00:01Z'))).toBe(false)
    expect(sameValue('a', null)).toBe(false)
    expect(sameValue(0, null)).toBe(false)
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

  it('arma el respaldo con la ruta y los datos de cada documento que se borra, y sobrevive a JSON', () => {
    const { deletes } = plan()
    const backup = JSON.parse(JSON.stringify(buildBackup(deletes, new Date('2026-11-06T10:00:00Z'))))
    expect(backup.count).toBe(6)
    expect(backup.docs.map(d => d.path)).toEqual(deletes.map(d => d.path))
    expect(backup.docs.find(d => d.path === 'users/u1/cars/c1').data.createdAt.__time).toBe('2026-01-10T15:00:00.000Z')
  })

  it('el nombre del archivo no tiene caracteres que Windows no acepta', () => {
    expect(backupFileName(new Date('2026-11-06T10:20:30.400Z'))).toBe('legacy-backup-2026-11-06T10-20-30-400Z.json')
  })
})
