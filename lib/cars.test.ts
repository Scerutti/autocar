import { describe, expect, it } from 'vitest'
import {
  MAX_PURGE_ATTEMPTS,
  PHOTO_GIVE_UP_MS,
  PURGE_DELAY_MS,
  carDeleteDecision,
  isCarId,
  photoFailureAction,
  purgeCutoff,
  purgePhotoId,
} from './cars'

describe('photoFailureAction', () => {
  const now = new Date('2026-11-05T12:00:00Z')
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000)

  it('el primer fallo se reintenta', () => {
    expect(photoFailureAction({}, now)).toBe('retry')
    expect(photoFailureAction({ purgeAttempts: null, photoFailedAt: null }, now)).toBe('retry')
  })

  it('se reintenta mientras no llega al tope de intentos', () => {
    expect(photoFailureAction({ purgeAttempts: MAX_PURGE_ATTEMPTS - 2, photoFailedAt: daysAgo(1) }, now)).toBe('retry')
  })

  it('al llegar al tope de intentos se borra el auto igual', () => {
    expect(photoFailureAction({ purgeAttempts: MAX_PURGE_ATTEMPTS - 1, photoFailedAt: daysAgo(1) }, now)).toBe('give-up')
    expect(photoFailureAction({ purgeAttempts: 10, photoFailedAt: daysAgo(1) }, now)).toBe('give-up')
  })

  it('pasados 7 días del primer fallo se borra el auto igual', () => {
    expect(photoFailureAction({ purgeAttempts: 1, photoFailedAt: daysAgo(7) }, now)).toBe('give-up')
    expect(photoFailureAction({ purgeAttempts: 1, photoFailedAt: new Date(now.getTime() - PHOTO_GIVE_UP_MS + 1) }, now)).toBe(
      'retry',
    )
  })
})

describe('carDeleteDecision', () => {
  const marked = new Date('2026-11-05T10:00:00Z')

  it('un auto que no existe ya está borrado', () => {
    expect(carDeleteDecision(null, 'u1')).toBe('gone')
  })

  it('el dueño marca un auto sin marca', () => {
    expect(carDeleteDecision({ ownerUid: 'u1', deletedAt: null }, 'u1')).toBe('mark')
    expect(carDeleteDecision({ ownerUid: 'u1' }, 'u1')).toBe('mark')
  })

  it('el dueño termina de borrar uno ya marcado', () => {
    expect(carDeleteDecision({ ownerUid: 'u1', deletedAt: marked }, 'u1')).toBe('purge')
  })

  it('quien no es el dueño no puede borrar, esté marcado o no', () => {
    expect(carDeleteDecision({ ownerUid: 'u1', deletedAt: null }, 'u2')).toBe('forbidden')
    expect(carDeleteDecision({ ownerUid: 'u1', deletedAt: marked }, 'u2')).toBe('forbidden')
  })

  it('un auto sin dueño no lo borra nadie', () => {
    expect(carDeleteDecision({ ownerUid: null, deletedAt: null }, 'u1')).toBe('forbidden')
    expect(carDeleteDecision({ deletedAt: null }, '')).toBe('forbidden')
  })
})

describe('purgeCutoff', () => {
  it('es una hora antes', () => {
    const now = new Date('2026-11-05T12:00:00Z')
    expect(purgeCutoff(now)).toEqual(new Date('2026-11-05T11:00:00Z'))
    expect(now.getTime() - purgeCutoff(now).getTime()).toBe(PURGE_DELAY_MS)
  })
})

describe('isCarId', () => {
  it('acepta los ids de Firestore', () => {
    expect(isCarId('aB3dE5fG7hJ9kL1mN3pQ')).toBe(true)
    expect(isCarId('car_1-x')).toBe(true)
  })

  it('rechaza ids vacíos, rutas y valores raros', () => {
    expect(isCarId('')).toBe(false)
    expect(isCarId('.')).toBe(false)
    expect(isCarId('..')).toBe(false)
    expect(isCarId('a/b')).toBe(false)
    expect(isCarId('x'.repeat(101))).toBe(false)
    expect(isCarId(undefined)).toBe(false)
    expect(isCarId(12)).toBe(false)
  })
})

describe('purgePhotoId', () => {
  it('devuelve la foto de la carpeta del dueño', () => {
    expect(purgePhotoId({ ownerUid: 'u1', photoPublicId: 'autocar/u1/abc-123' })).toBe('autocar/u1/abc-123')
  })

  it('sin foto, null', () => {
    expect(purgePhotoId({ ownerUid: 'u1', photoPublicId: null })).toBeNull()
    expect(purgePhotoId({ ownerUid: 'u1' })).toBeNull()
  })

  it('no borra una foto de otra carpeta ni con caracteres raros', () => {
    expect(purgePhotoId({ ownerUid: 'u1', photoPublicId: 'autocar/u2/abc' })).toBeNull()
    expect(purgePhotoId({ ownerUid: 'u1', photoPublicId: 'autocar/u1/../u2/abc' })).toBeNull()
    expect(purgePhotoId({ ownerUid: null, photoPublicId: 'autocar/u1/abc' })).toBeNull()
  })
})
