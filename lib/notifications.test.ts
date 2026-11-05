import { describe, expect, it } from 'vitest'
import {
  didRuleEscalate,
  effectiveRuleNotice,
  escalatedRules,
  isPushEndpoint,
  KM_TAG,
  MAX_MESSAGES_PER_RUN,
  MORE_TAG,
  orphanNoticeIds,
  planDailyNotifications,
  planJobNotification,
  planRuleAlerts,
  REVIEW_TAG,
  ruleAlertRecipients,
  ruleTag,
  updatesToPersist,
} from './notifications'
import type { Car, Job, MaintenanceRule, RuleNotice, UserSettings } from './types'

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
  baseKm: 10000,
  baseDate: '2026-01-10',
  lastDoneKm: 10000,
  lastDoneKmEstimated: false,
  lastDoneDate: '2026-01-10',
  lastDoneJobId: null,
  completedByJobId: null,
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
}

/** 2026-09-20 es domingo. */
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

  it('no avisa un recordatorio cumplido', () => {
    const done = { ...rule, repeat: false, completedByJobId: 'j1' }
    const { messages, ruleUpdates } = planDailyNotifications({ settings, cars: [car], rules: [done], today: '2026-09-21', now })
    expect(messages).toHaveLength(0)
    expect(ruleUpdates).toEqual([])
  })

  it('limpia el estado cuando el mantenimiento vuelve a estar al día', () => {
    const done = { ...rule, lastDoneKm: 14500, lastDoneDate: '2026-09-01', lastNotifiedStatus: 'soon' as const, lastNotifiedAt: now }
    const { messages, ruleUpdates } = planDailyNotifications({ settings, cars: [car], rules: [done], today: '2026-09-21', now })
    expect(messages).toHaveLength(0)
    expect(ruleUpdates).toEqual([{ ruleId: 'r1', lastNotifiedStatus: null, notified: false }])
  })

  it('usa el estado de avisado por persona: el miembro recibe su aviso aunque el dueño ya haya sido avisado', () => {
    const sharedCar: Car = { ...car, ownerUid: 'owner', memberUids: ['member'] }
    const notifiedOnRule: MaintenanceRule = { ...rule, lastNotifiedAt: now, lastNotifiedStatus: 'soon' }

    const ownerRun = planDailyNotifications({
      settings,
      cars: [sharedCar],
      rules: [notifiedOnRule],
      today: '2026-09-22',
      now: new Date('2026-09-21T12:00:00Z'),
      uid: 'owner',
      notices: new Map(),
    })
    expect(ownerRun.messages).toHaveLength(0)

    const memberRun = planDailyNotifications({
      settings,
      cars: [sharedCar],
      rules: [notifiedOnRule],
      today: '2026-09-22',
      now: new Date('2026-09-21T12:00:00Z'),
      uid: 'member',
      notices: new Map(),
    })
    expect(memberRun.messages).toHaveLength(1)
    expect(memberRun.ruleUpdates).toEqual([{ ruleId: 'r1', lastNotifiedStatus: 'soon', notified: true }])

    const memberRepeat = planDailyNotifications({
      settings,
      cars: [sharedCar],
      rules: [notifiedOnRule],
      today: '2026-09-22',
      now: new Date('2026-09-21T12:00:00Z'),
      uid: 'member',
      notices: new Map<string, RuleNotice>([['r1', { status: 'soon', at: now }]]),
    })
    expect(memberRepeat.messages).toHaveLength(0)
  })

  it('si el dueño tiene ruleNotices en null (se limpió al volver al día), no cae en el lastNotified viejo del documento', () => {
    const ownCar: Car = { ...car, ownerUid: 'owner' }
    const staleRule: MaintenanceRule = { ...rule, lastNotifiedAt: now, lastNotifiedStatus: 'soon' }
    const out = planDailyNotifications({
      settings,
      cars: [ownCar],
      rules: [staleRule],
      today: '2026-09-22',
      now: new Date('2026-09-21T12:00:00Z'),
      uid: 'owner',
      notices: new Map<string, RuleNotice>([['r1', { status: null, at: null }]]),
    })
    expect(out.messages).toHaveLength(1)
  })

  it('respeta el switch de avisos de autos compartidos y no pide km a un viewer', () => {
    const sharedCar: Car = {
      ...car,
      ownerUid: 'owner',
      memberUids: ['member'],
      memberProfiles: { member: { email: 'm@test.com', name: 'M', role: 'viewer' } },
    }
    const viewerSunday = planDailyNotifications({
      settings,
      cars: [sharedCar],
      rules: [rule],
      today: '2026-09-20',
      now,
      uid: 'member',
    })
    expect(viewerSunday.messages.map(m => m.tag)).toEqual([ruleTag('r1')])

    const muted = planDailyNotifications({
      settings: { ...settings, sharedCars: false },
      cars: [sharedCar],
      rules: [rule],
      today: '2026-09-20',
      now,
      uid: 'member',
    })
    expect(muted.messages).toHaveLength(0)
  })

  it('agrega el resumen de trabajos para revisar al dueño y le reserva lugar dentro del tope', () => {
    const single = planDailyNotifications({
      settings,
      cars: [car],
      rules: [],
      today: '2026-09-21',
      now,
      pendingReview: { count: 1, carId: 'c1' },
    })
    expect(single.messages).toEqual([
      {
        title: 'Tenés 1 trabajo para revisar',
        body: 'Tocá para aprobarlo o rechazarlo.',
        url: '/autos/c1?tab=trabajos',
        tag: REVIEW_TAG,
      },
    ])

    const rules = Array.from({ length: 10 }, (_, i) => ({ ...rule, id: `s${i}` }))
    const crowded = planDailyNotifications({
      settings,
      cars: [car],
      rules,
      today: '2026-09-20',
      now,
      pendingReview: { count: 2, carId: null },
    })
    expect(crowded.messages).toHaveLength(MAX_MESSAGES_PER_RUN)
    expect(crowded.messages.map(m => m.tag)).toContain(REVIEW_TAG)
    expect(crowded.messages.map(m => m.tag)).toContain('km-c1')
    expect(crowded.messages.map(m => m.tag)).toContain(MORE_TAG)
    expect(crowded.ruleUpdates).toHaveLength(MAX_MESSAGES_PER_RUN - 3)
  })
})

describe('planDailyNotifications con muchos avisos', () => {
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
    const saved = new Map(updatesToPersist(first.ruleUpdates, new Set(first.messages.map(m => m.tag))).map(u => [u.ruleId, u]))
    const after = rules.map(r => (saved.has(r.id) ? { ...r, lastNotifiedAt: now, lastNotifiedStatus: 'soon' as const } : r))
    const next = planDailyNotifications({ settings, cars: [car], rules: after, today: '2026-09-22', now: new Date('2026-09-21T12:00:00Z') })
    const firstTags = first.messages.map(m => m.tag).filter(t => t !== MORE_TAG)
    const nextTags = next.messages.map(m => m.tag).filter(t => t !== MORE_TAG)
    expect(nextTags.length).toBeGreaterThan(0)
    expect(nextTags.some(t => firstTags.includes(t))).toBe(false)
  })
})

describe('planRuleAlerts y escalatedRules', () => {
  it('avisa sólo cuando el mantenimiento sube de estado (ok → soon/overdue, soon → overdue)', () => {
    expect(didRuleEscalate(null, 'soon')).toBe(true)
    expect(didRuleEscalate('ok', 'overdue')).toBe(true)
    expect(didRuleEscalate('soon', 'overdue')).toBe(true)
    expect(didRuleEscalate('soon', 'soon')).toBe(false)
    expect(didRuleEscalate('overdue', 'soon')).toBe(false)
    expect(didRuleEscalate('overdue', 'overdue')).toBe(false)
    expect(didRuleEscalate(null, 'ok')).toBe(false)
  })

  it('effectiveRuleNotice usa rule.lastNotifiedStatus sólo como semilla del dueño', () => {
    const r = { lastNotifiedStatus: 'soon' as const, lastNotifiedAt: now }
    expect(effectiveRuleNotice(r, true, undefined)).toEqual({ status: 'soon', at: now })
    expect(effectiveRuleNotice(r, false, undefined)).toEqual({ status: null, at: null })
    expect(effectiveRuleNotice(r, true, { status: null, at: null })).toEqual({ status: null, at: null })
    const notices = new Map<string, RuleNotice>([
      ['r1', { status: 'soon', at: now }],
      ['deleted-rule', { status: 'overdue', at: now }],
    ])
    expect(orphanNoticeIds(notices, [rule])).toEqual(['deleted-rule'])
    expect(orphanNoticeIds(notices, [rule, { id: 'deleted-rule' }])).toEqual([])
  })

  it('planRuleAlerts arma el aviso con el mismo tag que el cron y no repite si ya estaba en ese estado', () => {
    const overdueCar = { ...car, currentKm: 15200 }
    const first = planRuleAlerts({ car: overdueCar, rules: [rule], owner: false, notices: new Map(), today: '2026-09-21' })
    expect(first).toHaveLength(1)
    expect(first[0].message.tag).toBe(ruleTag('r1'))
    expect(first[0].status).toBe('overdue')

    const repeat = planRuleAlerts({
      car: overdueCar,
      rules: [rule],
      owner: false,
      notices: new Map([['r1', { status: 'overdue', at: now }]]),
      today: '2026-09-21',
    })
    expect(repeat).toHaveLength(0)

    const fromSoon = planRuleAlerts({
      car: overdueCar,
      rules: [rule],
      owner: false,
      notices: new Map([['r1', { status: 'soon', at: now }]]),
      today: '2026-09-21',
    })
    expect(fromSoon).toHaveLength(1)
  })

  it('escalatedRules detecta qué mantenimiento pasó a por vencer o vencido con la nueva carga', () => {
    const beforeCar = { currentKm: 14000, avgKmPerDay: null }
    const afterSoon = { currentKm: 14600, avgKmPerDay: null }
    const afterOverdue = { currentKm: 15100, avgKmPerDay: null }

    expect(
      escalatedRules({ carBefore: beforeCar, carAfter: beforeCar, rulesBefore: [rule], rulesAfter: [rule], today: '2026-09-21' }),
    ).toEqual([])

    const toSoon = escalatedRules({
      carBefore: beforeCar,
      carAfter: afterSoon,
      rulesBefore: [rule],
      rulesAfter: [rule],
      today: '2026-09-21',
    })
    expect(toSoon.map(e => e.status)).toEqual(['soon'])

    const sameSoon = escalatedRules({
      carBefore: afterSoon,
      carAfter: { currentKm: 14700, avgKmPerDay: null },
      rulesBefore: [rule],
      rulesAfter: [rule],
      today: '2026-09-21',
    })
    expect(sameSoon).toEqual([])

    const toOverdue = escalatedRules({
      carBefore: afterSoon,
      carAfter: afterOverdue,
      rulesBefore: [rule],
      rulesAfter: [rule],
      today: '2026-09-21',
    })
    expect(toOverdue.map(e => e.status)).toEqual(['overdue'])
  })
})

describe('ruleAlertRecipients', () => {
  const sharedCar: Car = { ...car, ownerUid: 'owner', memberUids: ['m1', 'm2'] }

  it('avisa al resto del grupo sin quien hizo la carga', () => {
    expect(ruleAlertRecipients(sharedCar, 'm1')).toEqual(['owner', 'm2'])
    expect(ruleAlertRecipients(sharedCar, 'owner')).toEqual(['m1', 'm2'])
  })

  it('un auto sin miembros no tiene a quién avisar', () => {
    expect(ruleAlertRecipients({ ownerUid: 'owner', memberUids: [] }, 'owner')).toEqual([])
  })

  it('quien no es del grupo no puede pedir avisos', () => {
    expect(ruleAlertRecipients(sharedCar, 'otro')).toBeNull()
  })
})

describe('planJobNotification', () => {
  const sharedCar: Car = { ...car, ownerUid: 'owner', memberUids: ['m1', 'm2'] }
  const baseJob: Job = {
    id: 'j1',
    carId: 'c1',
    date: '2026-09-20',
    km: 14600,
    title: 'Cambio de aceite',
    category: 'service',
    cost: 50000,
    workshop: null,
    notes: null,
    ruleIds: ['r1'],
    status: 'pending',
    reviewedAt: null,
    revision: 2,
    createdBy: 'm1',
    createdByName: 'Ana',
    createdAt: now,
  }

  it('el miembro que mandó el trabajo avisa al dueño, con el id de idempotencia por revisión', () => {
    const res = planJobNotification({ uid: 'm1', car: sharedCar, job: baseJob, event: 'submitted' })
    expect(res).toEqual({
      ok: true,
      recipientUid: 'owner',
      noticeId: 'j1_submitted_2',
      message: expect.objectContaining({
        url: '/autos/c1/trabajos/j1',
        tag: 'job-review-j1',
      }),
    })
  })

  it('el dueño que aprueba o rechaza avisa al miembro autor', () => {
    const approved = planJobNotification({
      uid: 'owner',
      car: sharedCar,
      job: { ...baseJob, status: 'approved' },
      event: 'approved',
    })
    expect(approved).toMatchObject({ ok: true, recipientUid: 'm1', noticeId: 'j1_approved_2' })

    const rejected = planJobNotification({
      uid: 'owner',
      car: sharedCar,
      job: { ...baseJob, status: 'rejected' },
      event: 'rejected',
    })
    expect(rejected).toMatchObject({ ok: true, recipientUid: 'm1', noticeId: 'j1_rejected_2' })
  })

  it('rechaza a quien no es el autor ni el dueño o cuando el estado no coincide', () => {
    expect(planJobNotification({ uid: 'm2', car: sharedCar, job: baseJob, event: 'submitted' })).toEqual({ ok: false })
    expect(planJobNotification({ uid: 'owner', car: sharedCar, job: baseJob, event: 'submitted' })).toEqual({ ok: false })
    expect(planJobNotification({ uid: 'm1', car: sharedCar, job: { ...baseJob, status: 'approved' }, event: 'approved' })).toEqual({
      ok: false,
    })
    expect(planJobNotification({ uid: 'owner', car: sharedCar, job: baseJob, event: 'approved' })).toEqual({ ok: false })
    expect(
      planJobNotification({
        uid: 'owner',
        car: sharedCar,
        job: { ...baseJob, status: 'approved', createdBy: 'owner' },
        event: 'approved',
      }),
    ).toEqual({ ok: false })
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
