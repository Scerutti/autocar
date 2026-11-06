import { describe, expect, it, vi } from 'vitest'
import {
  accountLocalKeys,
  isSignOutMessage,
  retryWithin,
  settleWithin,
  signOutMessage,
  unsavedChangesWarning,
} from './sign-out'

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

describe('unsavedChangesWarning', () => {
  it('sin cambios no pide confirmación', () => {
    expect(unsavedChangesWarning(0)).toBeNull()
  })

  it('dice cuántos cambios se pierden', () => {
    expect(unsavedChangesWarning(1)?.description).toBe('Tenés 1 cambio sin guardar; si salís se pierde.')
    expect(unsavedChangesWarning(3)?.description).toBe('Tenés 3 cambios sin guardar; si salís se pierden.')
    expect(unsavedChangesWarning(3)?.confirmLabel).toBe('Salir igual')
  })
})

describe('isSignOutMessage', () => {
  it('reconoce el mensaje de salir', () => {
    expect(isSignOutMessage(signOutMessage('u1'))).toBe(true)
  })

  it('descarta otros mensajes', () => {
    expect(isSignOutMessage(null)).toBe(false)
    expect(isSignOutMessage('signout')).toBe(false)
    expect(isSignOutMessage({ type: 'signout' })).toBe(false)
    expect(isSignOutMessage({ type: 'signout', uid: '' })).toBe(false)
    expect(isSignOutMessage({ type: 'otro', uid: 'u1' })).toBe(false)
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
