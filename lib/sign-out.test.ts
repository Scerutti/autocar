import { describe, expect, it, vi } from 'vitest'
import type { OutboxEntry } from './outbox'
import {
  accountLocalKeys,
  followsSignOut,
  isSignOutMessage,
  leavesOnSignedOut,
  retryWithin,
  settleWithin,
  signOutMessage,
  signOutWarning,
  unsavedOutbox,
} from './sign-out'

const DAY = 86_400_000

const entry = (id: string, state: OutboxEntry['state'], createdAt: number) =>
  ({
    id,
    carId: 'c1',
    carLabel: 'Ford Ka',
    label: 'Km',
    createdAt,
    state,
    kind: 'km',
    payload: { recordId: id, data: { km: 1000, date: '2026-11-01' }, original: null },
  }) as OutboxEntry

describe('accountLocalKeys', () => {
  const keys = [
    'autocar:outbox:u1',
    'autocar:outbox:u2',
    'autocar:novedades-vistas',
    'autocar:aviso-oculto:u1',
    'autocar:aviso-oculto:km',
    'otra-app:u1',
    'firebase:authUser:x',
  ]

  it('borra las claves autocar de la cuenta y deja las preferencias del dispositivo', () => {
    expect(accountLocalKeys(keys, 'u1')).toEqual(['autocar:outbox:u1'])
  })

  it('no toca las claves de otra cuenta', () => {
    expect(accountLocalKeys(keys, 'u2')).toEqual(['autocar:outbox:u2'])
    expect(accountLocalKeys(keys, 'u3')).toEqual([])
  })

  it('no compara por sufijo parcial del uid', () => {
    expect(accountLocalKeys(['autocar:outbox:xu1'], 'u1')).toEqual([])
  })

  it('sin uid no borra nada', () => {
    expect(accountLocalKeys(keys, '')).toEqual([])
  })
})

describe('unsavedOutbox', () => {
  it('cuenta las entradas sin las vencidas y aparte las pendientes', () => {
    const now = 100 * DAY
    const entries = [entry('a', 'pending', now - DAY), entry('b', 'failed', now - DAY), entry('c', 'pending', now - 31 * DAY)]
    expect(unsavedOutbox(entries, now)).toEqual({ unsaved: 2, pending: 1 })
    expect(unsavedOutbox([], now)).toEqual({ unsaved: 0, pending: 0 })
  })
})

describe('signOutWarning', () => {
  it('sin nada que se pierda no pide confirmación', () => {
    expect(signOutWarning({ unsaved: 0, outboxPending: 0, writesPending: false })).toBeNull()
  })

  it('dice cuántos cambios de la bandeja se pierden', () => {
    expect(signOutWarning({ unsaved: 1, outboxPending: 0, writesPending: false })?.description).toBe(
      'Tenés 1 cambio sin guardar; si salís se pierde.',
    )
    const many = signOutWarning({ unsaved: 3, outboxPending: 1, writesPending: true })
    expect(many?.description).toBe('Tenés 3 cambios sin guardar; si salís se pierden.')
    expect(many?.confirmLabel).toBe('Salir igual')
  })

  it('suma las escrituras pendientes que no son de la bandeja', () => {
    expect(signOutWarning({ unsaved: 1, outboxPending: 0, writesPending: true })?.description).toBe(
      'Tenés 1 cambio sin guardar y otros cambios sin sincronizar; si salís se pierden.',
    )
    expect(signOutWarning({ unsaved: 2, outboxPending: 0, writesPending: true })?.description).toBe(
      'Tenés 2 cambios sin guardar y otros cambios sin sincronizar; si salís se pierden.',
    )
  })

  it('pregunta aunque la bandeja esté vacía si quedan escrituras pendientes', () => {
    expect(signOutWarning({ unsaved: 0, outboxPending: 0, writesPending: true })?.description).toBe(
      'Tenés cambios sin sincronizar; si salís se pierden.',
    )
  })
})

describe('isSignOutMessage', () => {
  it('reconoce el mensaje de salir', () => {
    expect(isSignOutMessage(signOutMessage('u1', 'tab-a'))).toBe(true)
  })

  it('descarta otros mensajes', () => {
    expect(isSignOutMessage(null)).toBe(false)
    expect(isSignOutMessage('signout')).toBe(false)
    expect(isSignOutMessage({ type: 'signout', uid: 'u1' })).toBe(false)
    expect(isSignOutMessage({ type: 'signout', uid: '', from: 'tab-a' })).toBe(false)
    expect(isSignOutMessage({ type: 'otro', uid: 'u1', from: 'tab-a' })).toBe(false)
  })
})

describe('followsSignOut', () => {
  const message = signOutMessage('u1', 'tab-a')

  it('sigue el aviso de otra pestaña de la misma cuenta', () => {
    expect(followsSignOut(message, 'tab-b', 'u1')).toBe(true)
  })

  it('ignora el propio, el de otra cuenta y el que llega sin sesión', () => {
    expect(followsSignOut(message, 'tab-a', 'u1')).toBe(false)
    expect(followsSignOut(message, 'tab-b', 'u2')).toBe(false)
    expect(followsSignOut(message, 'tab-b', null)).toBe(false)
    expect(followsSignOut({ type: 'otro' }, 'tab-b', 'u1')).toBe(false)
  })
})

describe('leavesOnSignedOut', () => {
  it('se va cuando se cierra la sesión que tenía, salvo la pestaña que sale', () => {
    expect(leavesOnSignedOut({ hadUser: true, hasUser: false, leading: false })).toBe(true)
    expect(leavesOnSignedOut({ hadUser: true, hasUser: false, leading: true })).toBe(false)
  })

  it('no se va al cargar sin sesión ni al entrar', () => {
    expect(leavesOnSignedOut({ hadUser: false, hasUser: false, leading: false })).toBe(false)
    expect(leavesOnSignedOut({ hadUser: false, hasUser: true, leading: false })).toBe(false)
    expect(leavesOnSignedOut({ hadUser: true, hasUser: true, leading: false })).toBe(false)
  })
})

describe('settleWithin', () => {
  it('resuelve done, failed o timeout', async () => {
    expect(await settleWithin(Promise.resolve(1), 50)).toBe('done')
    expect(await settleWithin(Promise.reject(new Error('x')), 50)).toBe('failed')
    expect(await settleWithin(new Promise(() => {}), 5)).toBe('timeout')
  })
})

describe('retryWithin', () => {
  it('termina en el primer intento sin reintentar', async () => {
    const onRetry = vi.fn()
    const start = vi.fn(() => Promise.resolve())
    expect(await retryWithin(start, { attempts: 3, waitMs: 5, onRetry })).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
    expect(onRetry).not.toHaveBeenCalled()
  })

  it('si se pasa del tiempo sigue esperando la misma promesa', async () => {
    let finish: () => void = () => {}
    const start = vi.fn(() => new Promise<void>(resolve => (finish = resolve)))
    const onRetry = vi.fn(() => finish())
    expect(await retryWithin(start, { attempts: 3, waitMs: 5, onRetry })).toBe(true)
    expect(start).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('si falla la vuelve a empezar, también si tira al llamarla', async () => {
    const start = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => {
        throw new Error('failed-precondition')
      })
      .mockImplementationOnce(() => Promise.reject(new Error('x')))
      .mockImplementation(() => Promise.resolve())
    expect(await retryWithin(start, { attempts: 3, waitMs: 5 })).toBe(true)
    expect(start).toHaveBeenCalledTimes(3)
  })

  it('después de todos los intentos devuelve false', async () => {
    const onRetry = vi.fn()
    expect(await retryWithin(() => new Promise(() => {}), { attempts: 2, waitMs: 5, onRetry })).toBe(false)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
