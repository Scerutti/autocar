import { describe, expect, it } from 'vitest'
import {
  isPushEndpoint,
  KM_TAG,
  MAX_MESSAGES_PER_RUN,
  MORE_TAG,
  planDailyNotifications,
  ruleTag,
  updatesToPersist,
} from './notifications'
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
  intervalTime: { amount: 12, unit: 'month' },
  repeat: true,
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

describe('planDailyNotifications con muchos avisos', () => {
  // Con el auto en 14600 km: "soon" faltan 400 km, "overdue" se pasó por 400 km.
  const soon = (id: string) => ({ ...rule, id })
  const overdue = (id: string) => ({ ...rule, id, lastDoneKm: 9000 })
  const many = (n: number, make: (id: string) => MaintenanceRule, prefix: string) =>
    Array.from({ length: n }, (_, i) => make(`${prefix}${i}`))

  it('no pasa del tope y resume el resto en un aviso que abre el inicio', () => {
    const rules = many(10, soon, 's')
    const { messages, ruleUpdates } = planDailyNotifications({ settings, cars: [car], rules, today: '2026-09-21', now })
    expect(messages).toHaveLength(MAX_MESSAGES_PER_RUN)
    const more = messages[messages.length - 1]
    expect(more).toMatchObject({ url: '/', tag: MORE_TAG })
    expect(more.body).toContain(`Y ${10 - (MAX_MESSAGES_PER_RUN - 1)} avisos más`)
    // Sólo se marcan como avisados los que se mandaron.
    expect(ruleUpdates.map(u => ruleTag(u.ruleId))).toEqual(messages.slice(0, -1).map(m => m.tag))
  })

  it('si entran justo, no agrega el resumen', () => {
    const rules = many(MAX_MESSAGES_PER_RUN, soon, 's')
    const { messages, ruleUpdates } = planDailyNotifications({ settings, cars: [car], rules, today: '2026-09-21', now })
    expect(messages).toHaveLength(MAX_MESSAGES_PER_RUN)
    expect(messages.map(m => m.tag)).not.toContain(MORE_TAG)
    expect(ruleUpdates).toHaveLength(MAX_MESSAGES_PER_RUN)
  })

  it('manda primero los vencidos, después los por vencer, y el pedido de km no se recorta', () => {
    // 2026-09-20 es el día del recordatorio de km.
    const rules = [...many(MAX_MESSAGES_PER_RUN, soon, 's'), ...many(2, overdue, 'o')]
    const { messages } = planDailyNotifications({ settings, cars: [car], rules, today: '2026-09-20', now })
    expect(messages).toHaveLength(MAX_MESSAGES_PER_RUN)
    expect(messages.slice(0, 2).every(m => m.title.startsWith('Vencido'))).toBe(true)
    expect(messages.slice(2, -2).every(m => m.title.startsWith('Se acerca'))).toBe(true)
    expect(messages.map(m => m.tag).slice(-2)).toEqual(['km-c1', MORE_TAG])
  })

  describe('con varios autos el día del recordatorio', () => {
    const cars = Array.from({ length: 7 }, (_, i) => ({ ...car, id: `c${i + 1}` }))

    it('si entran, pide los km de cada auto por separado', () => {
      const { messages } = planDailyNotifications({ settings, cars: cars.slice(0, 2), rules: many(2, soon, 's'), today: '2026-09-20', now })
      expect(messages.map(m => m.tag)).toEqual([ruleTag('s0'), ruleTag('s1'), 'km-c1', 'km-c2'])
    })

    it('si no entran, los pide todos juntos en un solo aviso', () => {
      const { messages } = planDailyNotifications({ settings, cars, rules: [], today: '2026-09-20', now })
      expect(messages).toEqual([expect.objectContaining({ url: '/', tag: KM_TAG })])
      expect(messages[0].body).toContain('7 autos')
    })

    it('el pedido de km tiene lugar aunque haya muchos avisos', () => {
      // 3 autos y 5 avisos: no entran los 8, pero los 5 avisos sí con el pedido de km juntado.
      const few = planDailyNotifications({ settings, cars: cars.slice(0, 3), rules: many(5, soon, 's'), today: '2026-09-20', now })
      expect(few.messages).toHaveLength(MAX_MESSAGES_PER_RUN)
      expect(few.messages.map(m => m.tag)).toContain(KM_TAG)
      expect(few.messages.map(m => m.tag)).not.toContain(MORE_TAG)
      expect(few.ruleUpdates).toHaveLength(5)

      const lots = planDailyNotifications({ settings, cars, rules: many(10, soon, 's'), today: '2026-09-20', now })
      expect(lots.messages).toHaveLength(MAX_MESSAGES_PER_RUN)
      expect(lots.messages.map(m => m.tag).slice(-2)).toEqual([KM_TAG, MORE_TAG])
      expect(lots.messages[lots.messages.length - 1].body).toContain(`Y ${10 - (MAX_MESSAGES_PER_RUN - 2)} avisos más`)
      expect(lots.ruleUpdates).toHaveLength(MAX_MESSAGES_PER_RUN - 2)
    })
  })

  it('los que no salieron hoy salen en la próxima corrida', () => {
    const rules = many(10, soon, 's')
    const first = planDailyNotifications({ settings, cars: [car], rules, today: '2026-09-21', now })
    // Llegó todo lo que se mandó: se guarda como avisado.
    const saved = new Map(updatesToPersist(first.ruleUpdates, new Set(first.messages.map(m => m.tag))).map(u => [u.ruleId, u]))
    const after = rules.map(r => (saved.has(r.id) ? { ...r, lastNotifiedAt: now, lastNotifiedStatus: 'soon' as const } : r))
    const next = planDailyNotifications({ settings, cars: [car], rules: after, today: '2026-09-22', now: new Date('2026-09-21T12:00:00Z') })
    const firstTags = first.messages.map(m => m.tag).filter(t => t !== MORE_TAG)
    const nextTags = next.messages.map(m => m.tag).filter(t => t !== MORE_TAG)
    expect(nextTags.length).toBeGreaterThan(0)
    expect(nextTags.some(t => firstTags.includes(t))).toBe(false)
  })
})

describe('isPushEndpoint', () => {
  it('acepta los servicios de push de los navegadores', () => {
    expect(isPushEndpoint('https://fcm.googleapis.com/fcm/send/abc:123')).toBe(true)
    expect(isPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc')).toBe(true)
    expect(isPushEndpoint('https://wns2-par02p.notify.windows.com/w/?token=abc')).toBe(true)
    expect(isPushEndpoint('https://web.push.apple.com/QGx')).toBe(true)
  })
  it('rechaza cualquier otra dirección', () => {
    expect(isPushEndpoint('http://fcm.googleapis.com/fcm/send/abc')).toBe(false)
    expect(isPushEndpoint('https://169.254.169.254/latest/meta-data')).toBe(false)
    expect(isPushEndpoint('https://localhost:3000/api')).toBe(false)
    expect(isPushEndpoint('https://googleapis.com.evil.com/x')).toBe(false)
    expect(isPushEndpoint('https://evilgoogleapis.com/x')).toBe(false)
    expect(isPushEndpoint('no es una url')).toBe(false)
    expect(isPushEndpoint(undefined)).toBe(false)
  })
})

describe('updatesToPersist', () => {
  const updates = [
    { ruleId: 'a', lastNotifiedStatus: 'overdue' as const, notified: true },
    { ruleId: 'b', lastNotifiedStatus: 'soon' as const, notified: true },
    { ruleId: 'c', lastNotifiedStatus: null, notified: false },
  ]
  it('sólo marca como avisados los mantenimientos cuyo aviso llegó', () => {
    // Llegó el recordatorio de km y el aviso de "a", pero el de "b" falló: "b" se reintenta mañana.
    const delivered = new Set(['km-c1', ruleTag('a')])
    expect(updatesToPersist(updates, delivered).map(u => u.ruleId)).toEqual(['a', 'c'])
  })
  it('si no llegó nada, sólo guarda las que limpian el estado', () => {
    expect(updatesToPersist(updates, new Set()).map(u => u.ruleId)).toEqual(['c'])
  })
  it('el tag del aviso es el que usa planDailyNotifications', () => {
    const { messages } = planDailyNotifications({
      settings: { reminder: { enabled: false, weekday: 0 }, timezone: 'America/Argentina/Buenos_Aires' },
      cars: [car],
      rules: [{ ...rule, lastDoneKm: 0 }],
      today: '2026-09-10',
      now: new Date('2026-09-10T12:00:00Z'),
    })
    expect(messages.map(m => m.tag)).toEqual([ruleTag('r1')])
  })
})
