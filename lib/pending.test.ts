import { describe, expect, it } from 'vitest'
import type { RuleState, RuleWithState } from './maintenance'
import { kmDueDay, kmDueSince, pendingItems, urgentCount } from './pending'
import type { Car, MaintenanceRule, UserSettings } from './types'

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

describe('pendingItems', () => {
  const rulesByCar = new Map([['c1', [withState('ok', 'ok'), withState('soon', 'soon'), withState('overdue', 'overdue')]]])

  it('ordena vencidos, km y por vencer, y deja afuera lo que está al día', () => {
    const items = pendingItems({ settings, cars: [car], rulesByCar, today: '2026-09-28' })
    expect(items.map(i => (i.kind === 'km' ? 'km' : i.rule.id))).toEqual(['overdue', 'km', 'soon'])
  })

  it('el número cuenta los vencidos y los km, no los por vencer', () => {
    expect(urgentCount(pendingItems({ settings, cars: [car], rulesByCar, today: '2026-09-28' }))).toBe(2)
    expect(urgentCount(pendingItems({ settings, cars: [car], rulesByCar, today: '2026-09-21' }))).toBe(1)
  })

  it('sin autos no hay nada pendiente', () => {
    expect(pendingItems({ settings, cars: [], rulesByCar, today: '2026-09-28' })).toEqual([])
  })
})
