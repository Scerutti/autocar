import { describe, expect, it } from 'vitest'
import { planDailyNotifications } from './notifications'
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
  kmUpdatedAt: null,
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
  intervalMonths: 12,
  lastDoneKm: 10000,
  lastDoneDate: '2026-01-10',
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
}

// 2026-09-20 es domingo
const settings: UserSettings = { reminder: { enabled: true, weekday: 0 }, timezone: 'America/Argentina/Buenos_Aires' }
const now = new Date('2026-09-20T12:00:00Z')

describe('planDailyNotifications', () => {
  it('pide los km el día elegido', () => {
    const { messages } = planDailyNotifications({ settings, cars: [car], rules: [], today: '2026-09-20', now })
    expect(messages).toHaveLength(1)
    expect(messages[0].url).toBe('/autos/c1/km')
  })

  it('no pide km otro día ni con el recordatorio apagado', () => {
    expect(planDailyNotifications({ settings, cars: [car], rules: [], today: '2026-09-21', now }).messages).toHaveLength(0)
    const off = { ...settings, reminder: { enabled: false, weekday: 0 } }
    expect(planDailyNotifications({ settings: off, cars: [car], rules: [], today: '2026-09-20', now }).messages).toHaveLength(0)
  })

  it('avisa un mantenimiento próximo una vez y no lo repite al día siguiente', () => {
    const first = planDailyNotifications({ settings, cars: [car], rules: [rule], today: '2026-09-21', now })
    expect(first.messages).toHaveLength(1)
    expect(first.messages[0].body).toContain('faltan 400 km')
    expect(first.ruleUpdates).toEqual([{ ruleId: 'r1', lastNotifiedStatus: 'soon', notified: true }])

    const notified = { ...rule, lastNotifiedAt: now, lastNotifiedStatus: 'soon' as const }
    const next = planDailyNotifications({ settings, cars: [car], rules: [notified], today: '2026-09-22', now: new Date('2026-09-21T12:00:00Z') })
    expect(next.messages).toHaveLength(0)
  })

  it('vuelve a avisar a los 7 días o si pasa a vencido', () => {
    const notified = { ...rule, lastNotifiedAt: now, lastNotifiedStatus: 'soon' as const }
    const week = planDailyNotifications({ settings, cars: [car], rules: [notified], today: '2026-09-28', now: new Date('2026-09-27T12:00:00Z') })
    expect(week.messages).toHaveLength(1)
    const overdue = planDailyNotifications({
      settings,
      cars: [{ ...car, currentKm: 15100 }],
      rules: [notified],
      today: '2026-09-22',
      now: new Date('2026-09-21T12:00:00Z'),
    })
    expect(overdue.messages[0].title).toContain('Vencido')
  })

  it('limpia el estado cuando el mantenimiento vuelve a estar al día', () => {
    const done = { ...rule, lastDoneKm: 14500, lastDoneDate: '2026-09-01', lastNotifiedStatus: 'soon' as const, lastNotifiedAt: now }
    const { messages, ruleUpdates } = planDailyNotifications({ settings, cars: [car], rules: [done], today: '2026-09-21', now })
    expect(messages).toHaveLength(0)
    expect(ruleUpdates).toEqual([{ ruleId: 'r1', lastNotifiedStatus: null, notified: false }])
  })
})
