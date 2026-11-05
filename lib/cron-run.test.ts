import { describe, expect, it } from 'vitest'
import {
  MAX_FAILURES,
  RUN_LOCK_MS,
  candidateUids,
  queueFrom,
  runDateOf,
  runIsBusy,
  runIsDone,
  summarizeRun,
  tally,
  type CronRunState,
  type CronUserReport,
} from './cron-run'

const state = (over: Partial<CronRunState> = {}): CronRunState => ({
  runningSince: null,
  finishedAt: new Date('2026-11-05T12:00:40Z'),
  processed: 0,
  skipped: 0,
  errors: 0,
  sent: 0,
  cursor: null,
  failures: [],
  ...over,
})

const ok = (uid: string, sent = 0): CronUserReport => ({ uid, messages: sent, sent })
const failed = (uid: string, error = 'boom'): CronUserReport => ({ uid, messages: 0, sent: 0, error })

describe('runDateOf', () => {
  it('usa la fecha UTC aunque en Argentina todavía sea el día anterior', () => {
    expect(runDateOf(new Date('2026-11-05T22:30:00-03:00'))).toBe('2026-11-06')
    expect(runDateOf(new Date('2026-11-05T20:59:00-03:00'))).toBe('2026-11-05')
  })
})

describe('candidateUids', () => {
  it('saca el uid de cada suscripción, sin repetir y ordenado', () => {
    const paths = [
      'users/zeta/pushSubscriptions/a',
      'users/alfa/pushSubscriptions/b',
      'users/zeta/pushSubscriptions/c',
    ]
    expect(candidateUids(paths)).toEqual(['alfa', 'zeta'])
  })

  it('ignora las rutas que no son users/{uid}/pushSubscriptions/{id}', () => {
    const paths = [
      'cars/c1/pushSubscriptions/x',
      'users/u1/otra/x/pushSubscriptions/y',
      'users//pushSubscriptions/x',
      'users/u2/pushSubscriptions/ok',
    ]
    expect(candidateUids(paths)).toEqual(['u2'])
  })

  it('sin suscripciones no hay candidatos', () => {
    expect(candidateUids([])).toEqual([])
  })
})

describe('runIsDone', () => {
  it('sin registro del día hay que correr', () => {
    expect(runIsDone(null)).toBe(false)
  })

  it('una corrida que terminó sin dejar a nadie afuera deja el día hecho', () => {
    expect(runIsDone(state())).toBe(true)
  })

  it('si quedaron usuarios afuera hay que seguir', () => {
    expect(runIsDone(state({ skipped: 3, cursor: 'm' }))).toBe(false)
  })

  it('si la anterior se cortó sin terminar hay que seguir', () => {
    expect(runIsDone(state({ finishedAt: null }))).toBe(false)
  })
})

describe('runIsBusy', () => {
  const now = new Date('2026-11-05T12:00:30Z')

  it('sin registro o con una corrida terminada no está ocupada', () => {
    expect(runIsBusy(null, now)).toBe(false)
    expect(runIsBusy(state({ runningSince: new Date('2026-11-05T12:00:00Z') }), now)).toBe(false)
  })

  it('una corrida en curso dentro de RUN_LOCK_MS bloquea a otra llamada', () => {
    expect(runIsBusy(state({ finishedAt: null, runningSince: new Date('2026-11-05T12:00:00Z') }), now)).toBe(true)
  })

  it('pasado RUN_LOCK_MS sin terminar se considera cortada y deja retomar', () => {
    const started = new Date(now.getTime() - RUN_LOCK_MS)
    expect(runIsBusy(state({ finishedAt: null, runningSince: started }), now)).toBe(false)
  })
})

describe('queueFrom', () => {
  const uids = ['a', 'b', 'c', 'd']

  it('sin corrida previa procesa a todos', () => {
    expect(queueFrom(uids, null)).toEqual(uids)
  })

  it('retoma después del cursor', () => {
    expect(queueFrom(uids, state({ skipped: 2, cursor: 'b' }))).toEqual(['c', 'd'])
  })

  it('un candidato nuevo antes del cursor queda para mañana', () => {
    expect(queueFrom(['a', 'aa', 'b', 'c'], state({ skipped: 1, cursor: 'b' }))).toEqual(['c'])
  })

  it('una corrida cortada sin cursor arranca de cero', () => {
    expect(queueFrom(uids, state({ finishedAt: null }))).toEqual(uids)
  })

  it('con la lista vacía no hay nada que hacer', () => {
    expect(queueFrom([], state({ skipped: 1, cursor: 'b' }))).toEqual([])
  })
})

describe('tally', () => {
  it('cuenta procesados, errores y mensajes enviados', () => {
    expect(tally([ok('a', 2), failed('b'), ok('c', 1)])).toEqual({ processed: 3, errors: 1, sent: 3 })
  })
})

describe('summarizeRun', () => {
  const queue = ['a', 'b', 'c', 'd']

  it('lista vacía: nada procesado, nada afuera, sin cursor', () => {
    expect(summarizeRun({ queue: [], next: 0, reports: [], candidates: 0, previous: null })).toEqual({
      candidates: 0,
      processed: 0,
      skipped: 0,
      errors: 0,
      sent: 0,
      cursor: null,
      failures: [],
    })
  })

  it('corte a mitad: el cursor es el último procesado y cuenta los salteados', () => {
    const out = summarizeRun({ queue, next: 2, reports: [ok('a', 1), ok('b', 2)], candidates: 4, previous: null })
    expect(out).toMatchObject({ processed: 2, skipped: 2, sent: 3, cursor: 'b' })
  })

  it('cursor al final: la corrida terminó y el cursor queda en null', () => {
    const reports = queue.map(uid => ok(uid))
    const out = summarizeRun({ queue, next: 4, reports, candidates: 4, previous: null })
    expect(out).toMatchObject({ processed: 4, skipped: 0, cursor: null })
  })

  it('sin tiempo para nadie conserva el cursor de la corrida anterior', () => {
    const previous = state({ processed: 5, skipped: 4, cursor: 'zz' })
    const out = summarizeRun({ queue, next: 0, reports: [], candidates: 9, previous })
    expect(out).toMatchObject({ processed: 5, skipped: 4, cursor: 'zz' })
  })

  it('la segunda corrida acumula las métricas del día', () => {
    const previous = state({ processed: 10, skipped: 2, errors: 1, sent: 7, cursor: 'b', failures: [{ uid: 'x', message: 'boom' }] })
    const out = summarizeRun({ queue: ['c', 'd'], next: 2, reports: [ok('c', 1), failed('d', 'timeout')], candidates: 12, previous })
    expect(out).toEqual({
      candidates: 12,
      processed: 12,
      skipped: 0,
      errors: 2,
      sent: 8,
      cursor: null,
      failures: [
        { uid: 'x', message: 'boom' },
        { uid: 'd', message: 'timeout' },
      ],
    })
  })

  it(`guarda como mucho ${MAX_FAILURES} usuarios con error`, () => {
    const many = Array.from({ length: MAX_FAILURES + 5 }, (_, i) => `u${String(i).padStart(2, '0')}`)
    const out = summarizeRun({ queue: many, next: many.length, reports: many.map(uid => failed(uid)), candidates: many.length, previous: null })
    expect(out.errors).toBe(MAX_FAILURES + 5)
    expect(out.failures).toHaveLength(MAX_FAILURES)
    expect(out.failures[0].uid).toBe('u00')
  })
})
