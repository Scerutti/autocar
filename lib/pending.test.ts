import { describe, expect, it } from 'vitest'
import type { RuleState, RuleWithState } from './maintenance'
import { kmDueDay, kmDueSince, pendingItems, urgentCount, type PendingItem } from './pending'
import type { Car, Invite, Job, MaintenanceRule, UserSettings } from './types'

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
  baseKm: 10000,
  baseDate: null,
  lastDoneKm: 10000,
  lastDoneKmEstimated: false,
  lastDoneDate: null,
  lastDoneJobId: null,
  completedByJobId: null,
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
  revision: 0,
  createdBy: OWNER,
  createdByName: 'Ana',
  createdAt: new Date(0),
  ...extra,
})

const key = (i: PendingItem) => {
  if (i.kind === 'rule') return i.rule.id
  if (i.kind === 'review' || i.kind === 'rejected') return `${i.kind}:${i.job.id}`
  if (i.kind === 'invite') return `invite:${i.invite.id}`
  return 'km'
}

const NOW = new Date(2026, 8, 21, 12)

const invite = (extra: Partial<Invite> = {}): Invite => ({
  id: 'c9_beto@gmail.com',
  carId: 'c9',
  ownerUid: 'u3',
  ownerName: 'Caro',
  carLabel: 'Fiat Uno 2010',
  email: 'beto@gmail.com',
  emailKey: 'beto@gmail.com',
  status: 'pending',
  createdAt: new Date(2026, 8, 20, 12),
  expiresAt: new Date(2026, 9, 4, 12),
  respondedAt: null,
  acceptedUid: null,
  ...extra,
})

const base = { settings, jobs: [] as Job[], uid: OWNER, invites: [] as Invite[], now: NOW }

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

  it('un recordatorio cumplido no está pendiente', () => {
    const done: RuleWithState = { rule: { ...rule, id: 'done', repeat: false, completedByJobId: 'j1' }, state: state('overdue') }
    const items = pendingItems({ ...base, cars: [car], rulesByCar: new Map([['c1', [done]]]), today: '2026-09-21' })
    expect(items.map(key)).toEqual([])
  })

  it('a un miembro viewer no se le piden los km; a un editor o trusted, sí', () => {
    const asMember = (role: 'editor' | 'trusted' | 'viewer') => ({
      ...car,
      memberUids: [MEMBER],
      memberProfiles: { [MEMBER]: { email: 'beto@gmail.com', name: 'Beto', role } },
    })
    const input = { ...base, uid: MEMBER, rulesByCar: new Map(), today: '2026-09-28' }
    expect(pendingItems({ ...input, cars: [asMember('viewer')] }).map(key)).toEqual([])
    expect(pendingItems({ ...input, cars: [asMember('editor')] }).map(key)).toEqual(['km'])
    expect(pendingItems({ ...input, cars: [asMember('trusted')] }).map(key)).toEqual(['km'])
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
    const items = pendingItems({ ...base, uid: MEMBER, jobs, cars: [car], rulesByCar: new Map(), today: '2026-09-21' })
    expect(items.map(key)).toEqual(['rejected:mine'])
  })

  it('un auto compartido no es un pendiente', () => {
    const input = { ...base, cars: [car], rulesByCar: new Map(), today: '2026-09-21' }
    expect(pendingItems({ ...input, uid: MEMBER }).map(key)).toEqual([])
  })

  it('las invitaciones pendientes aparecen hasta que vencen, y las respondidas o canceladas no', () => {
    const input = { ...base, cars: [], rulesByCar: new Map(), today: '2026-09-21' }
    expect(pendingItems({ ...input, invites: [invite()] }).map(key)).toEqual(['invite:c9_beto@gmail.com'])
    expect(pendingItems({ ...input, invites: [invite({ expiresAt: NOW })] })).toEqual([])
    expect(pendingItems({ ...input, invites: [invite({ status: 'accepted' })] })).toEqual([])
    expect(pendingItems({ ...input, invites: [invite({ status: 'declined' })] })).toEqual([])
    expect(pendingItems({ ...input, invites: [invite({ status: 'revoked' })] })).toEqual([])
  })

  it('ordena vencidos, para revisar, km, rechazados, invitaciones y por vencer, y todos suman salvo los por vencer', () => {
    const shared: Car = { ...car, id: 'c2', ownerUid: 'u3', ownerName: 'Caro', members: ['ana@gmail.com'] }
    const jobs = [
      job({ id: 'p', status: 'pending', createdBy: MEMBER }),
      job({ id: 'x', carId: 'c2', status: 'rejected', createdBy: OWNER }),
    ]
    const rules = new Map([['c1', [withState('soon', 'soon'), withState('overdue', 'overdue')]]])
    const items = pendingItems({ ...base, jobs, invites: [invite()], cars: [car, shared], rulesByCar: rules, today: '2026-09-28' })
    expect(items.map(key)).toEqual(['overdue', 'review:p', 'km', 'km', 'rejected:x', 'invite:c9_beto@gmail.com', 'soon'])
    expect(urgentCount(items)).toBe(6)
  })
})
