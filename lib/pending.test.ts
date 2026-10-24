import { describe, expect, it } from 'vitest'
import type { RuleState, RuleWithState } from './maintenance'
import { kmDueDay, kmDueSince, parseSeenCars, pendingItems, urgentCount, type PendingItem } from './pending'
import type { Car, Job, MaintenanceRule, UserSettings } from './types'

const OWNER = 'u1'
const MEMBER = 'u2'

const car: Car = {
  id: 'c1',
  brand: 'Ford',
  model: 'Focus',
  version: null,
  year: 2018,
  plate: null,
  fuelTypes: ['nafta'],
  currentKm: 14600,
  kmUpdatedAt: new Date(2026, 8, 20, 10),
  avgKmPerDay: null,
  photoUrl: null,
  photoPublicId: null,
  createdAt: new Date(0),
  ownerUid: OWNER,
  ownerName: 'Ana',
  members: ['beto@gmail.com'],
}

const rule: MaintenanceRule = {
  id: 'r1',
  carId: 'c1',
  name: 'Service',
  intervalKm: 5000,
  intervalTime: null,
  repeat: true,
  lastDoneKm: 10000,
  lastDoneDate: null,
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
}

const state = (status: RuleState['status']) => ({ status }) as RuleState
const withState = (id: string, status: RuleState['status']): RuleWithState => ({ rule: { ...rule, id }, state: state(status) })

/** 2026-09-20 es domingo. */
const settings: UserSettings = { reminder: { enabled: true, weekday: 0 }, timezone: 'America/Argentina/Buenos_Aires' }

describe('kmDueSince', () => {
  it('no debe nada si el km se cargó desde el último recordatorio', () => {
    expect(kmDueSince(settings, car, '2026-09-20')).toBeNull()
    expect(kmDueSince(settings, car, '2026-09-26')).toBeNull()
  })

  it('debe los km desde el día del recordatorio hasta que se cargan', () => {
    expect(kmDueSince(settings, car, '2026-09-27')).toBe('2026-09-27')
    expect(kmDueSince(settings, car, '2026-09-30')).toBe('2026-09-27')
  })

  it('un km cargado el día anterior al recordatorio no alcanza', () => {
    expect(kmDueSince(settings, { kmUpdatedAt: new Date(2026, 8, 19, 22) }, '2026-09-20')).toBe('2026-09-20')
  })

  it('debe los km de un auto que nunca los cargó', () => {
    expect(kmDueSince(settings, { kmUpdatedAt: null }, '2026-09-22')).toBe('2026-09-20')
  })

  it('no debe nada con el recordatorio apagado', () => {
    const off = { ...settings, reminder: { enabled: false, weekday: 0 } }
    expect(kmDueSince(off, { kmUpdatedAt: null }, '2026-09-22')).toBeNull()
  })

  it('respeta el día elegido', () => {
    const wednesday = { ...settings, reminder: { enabled: true, weekday: 3 } }
    expect(kmDueSince(wednesday, car, '2026-09-22')).toBeNull()
    expect(kmDueSince(wednesday, car, '2026-09-23')).toBe('2026-09-23')
  })
})

describe('kmDueDay', () => {
  it('dice hoy o el día de la semana', () => {
    expect(kmDueDay('2026-09-20', '2026-09-20')).toBe('hoy')
    expect(kmDueDay('2026-09-20', '2026-09-23')).toBe('el domingo')
  })
})

const job = (extra: Partial<Job> = {}): Job => ({
  id: 'j1',
  carId: 'c1',
  date: '2026-09-20',
  km: null,
  title: 'Service',
  category: 'service',
  cost: 1000,
  workshop: null,
  notes: null,
  ruleIds: [],
  status: 'approved',
  createdBy: OWNER,
  createdByName: 'Ana',
  createdAt: new Date(0),
  ...extra,
})

const key = (i: PendingItem) => {
  if (i.kind === 'rule') return i.rule.id
  if (i.kind === 'review' || i.kind === 'rejected') return `${i.kind}:${i.job.id}`
  if (i.kind === 'shared') return `shared:${i.car.id}`
  return 'km'
}

const base = { settings, jobs: [] as Job[], uid: OWNER, seenShared: [] as string[] }

describe('pendingItems', () => {
  const rulesByCar = new Map([['c1', [withState('ok', 'ok'), withState('soon', 'soon'), withState('overdue', 'overdue')]]])

  it('ordena vencidos, km y por vencer, y deja afuera lo que está al día', () => {
    const items = pendingItems({ ...base, cars: [car], rulesByCar, today: '2026-09-28' })
    expect(items.map(key)).toEqual(['overdue', 'km', 'soon'])
  })

  it('el número cuenta los vencidos y los km, no los por vencer', () => {
    expect(urgentCount(pendingItems({ ...base, cars: [car], rulesByCar, today: '2026-09-28' }))).toBe(2)
    expect(urgentCount(pendingItems({ ...base, cars: [car], rulesByCar, today: '2026-09-21' }))).toBe(1)
  })

  it('sin autos no hay nada pendiente', () => {
    expect(pendingItems({ ...base, cars: [], rulesByCar, today: '2026-09-28' })).toEqual([])
  })

  it('el dueño ve los trabajos pendientes de sus autos para revisar', () => {
    const jobs = [
      job({ id: 'p', status: 'pending', createdBy: MEMBER }),
      job({ id: 'a', status: 'approved', createdBy: MEMBER }),
      job({ id: 'r', status: 'rejected', createdBy: MEMBER }),
    ]
    const items = pendingItems({ ...base, jobs, cars: [car], rulesByCar: new Map(), today: '2026-09-21' })
    expect(items.map(key)).toEqual(['review:p'])
  })

  it('el miembro ve sus trabajos rechazados y no los de otros ni los que hay para revisar', () => {
    const jobs = [
      job({ id: 'mine', status: 'rejected', createdBy: MEMBER }),
      job({ id: 'other', status: 'rejected', createdBy: 'u3' }),
      job({ id: 'pending', status: 'pending', createdBy: MEMBER }),
    ]
    const items = pendingItems({ ...base, uid: MEMBER, seenShared: ['c1'], jobs, cars: [car], rulesByCar: new Map(), today: '2026-09-21' })
    expect(items.map(key)).toEqual(['rejected:mine'])
  })

  it('un auto compartido aparece hasta marcarlo visto, y uno propio nunca', () => {
    const input = { ...base, cars: [car], rulesByCar: new Map(), today: '2026-09-21' }
    expect(pendingItems(input).map(key)).toEqual([])
    expect(pendingItems({ ...input, uid: MEMBER }).map(key)).toEqual(['shared:c1'])
    expect(pendingItems({ ...input, uid: MEMBER, seenShared: ['c1'] }).map(key)).toEqual([])
  })

  it('ordena vencidos, para revisar, km, rechazados, compartidos nuevos y por vencer, y todos suman salvo los por vencer', () => {
    const shared: Car = { ...car, id: 'c2', ownerUid: 'u3', ownerName: 'Caro', members: ['ana@gmail.com'] }
    const jobs = [
      job({ id: 'p', status: 'pending', createdBy: MEMBER }),
      job({ id: 'x', carId: 'c2', status: 'rejected', createdBy: OWNER }),
    ]
    const rules = new Map([['c1', [withState('soon', 'soon'), withState('overdue', 'overdue')]]])
    const items = pendingItems({ ...base, jobs, cars: [car, shared], rulesByCar: rules, today: '2026-09-28' })
    expect(items.map(key)).toEqual(['overdue', 'review:p', 'km', 'km', 'rejected:x', 'shared:c2', 'soon'])
    expect(urgentCount(items)).toBe(6)
  })
})

describe('parseSeenCars', () => {
  it('lee la lista guardada y tolera lo que no sirve', () => {
    expect(parseSeenCars('["c1","c2"]')).toEqual(['c1', 'c2'])
    expect(parseSeenCars('[1,"c1"]')).toEqual(['c1'])
    expect(parseSeenCars('no es json')).toEqual([])
    expect(parseSeenCars('{"a":1}')).toEqual([])
    expect(parseSeenCars(null)).toEqual([])
    expect(parseSeenCars(undefined)).toEqual([])
  })
})
