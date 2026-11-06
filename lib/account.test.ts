import { describe, expect, it } from 'vitest'
import {
  accountDeleteOutcome,
  accountImagePrefix,
  accountPhotoRange,
  carsBlockingAccountDeletion,
  chunks,
  imagesToDelete,
  isDeleteConfirmed,
  otherCarOfRecord,
  photosToKeep,
} from './account'

const ME = 'me-uid'

const car = (id: string, extra: { ownerUid?: string; memberUids?: string[]; deletedAt?: Date | null; plate?: string | null } = {}) => ({
  id,
  brand: 'Ford',
  model: 'Ka',
  version: null,
  year: 2015,
  plate: null,
  ownerUid: ME,
  memberUids: [],
  deletedAt: null,
  ...extra,
})

describe('isDeleteConfirmed', () => {
  it('pide la palabra BORRAR, sin importar mayúsculas ni espacios', () => {
    expect(isDeleteConfirmed('BORRAR')).toBe(true)
    expect(isDeleteConfirmed(' Borrar ')).toBe(true)
    expect(isDeleteConfirmed('borra')).toBe(false)
    expect(isDeleteConfirmed('')).toBe(false)
    expect(isDeleteConfirmed('BORRAR CUENTA')).toBe(false)
  })
})

describe('carsBlockingAccountDeletion', () => {
  it('devuelve los autos propios con miembros', () => {
    const cars = [car('a', { memberUids: ['x'], plate: 'AB123CD' }), car('b'), car('c', { memberUids: ['x', 'y'] })]
    expect(carsBlockingAccountDeletion(cars, ME)).toEqual([
      { id: 'a', label: 'Ford Ka 2015 (AB123CD)' },
      { id: 'c', label: 'Ford Ka 2015' },
    ])
  })

  it('no cuenta los autos de otros ni los ya marcados como borrados', () => {
    const cars = [car('a', { ownerUid: 'other', memberUids: [ME] }), car('b', { memberUids: ['x'], deletedAt: new Date() })]
    expect(carsBlockingAccountDeletion(cars, ME)).toEqual([])
  })

  it('sin autos no bloquea', () => {
    expect(carsBlockingAccountDeletion([], ME)).toEqual([])
  })
})

describe('otherCarOfRecord', () => {
  const owned = new Set(['mine'])

  it('devuelve el auto de un registro en un auto ajeno', () => {
    expect(otherCarOfRecord('cars/theirs/jobs/j1', owned)).toBe('theirs')
    expect(otherCarOfRecord('cars/theirs/fuel/f1', owned)).toBe('theirs')
    expect(otherCarOfRecord('cars/theirs/odometer/fuel-f1', owned)).toBe('theirs')
  })

  it('saltea los autos propios, las colecciones viejas y otras rutas', () => {
    expect(otherCarOfRecord('cars/mine/jobs/j1', owned)).toBeNull()
    expect(otherCarOfRecord('users/u1/jobs/j1', owned)).toBeNull()
    expect(otherCarOfRecord('cars/theirs/rules/r1', owned)).toBeNull()
    expect(otherCarOfRecord('cars/theirs/jobs/j1/extra/x', owned)).toBeNull()
  })
})

describe('accountImagePrefix', () => {
  it('es la carpeta de la cuenta con la barra final', () => {
    expect(accountImagePrefix('abc')).toBe('autocar/abc/')
  })
})

describe('accountDeleteOutcome', () => {
  it('borrada', () => {
    expect(accountDeleteOutcome(200, { deleted: true })).toEqual({ kind: 'deleted' })
  })

  it('409 con los autos que hay que resolver', () => {
    expect(accountDeleteOutcome(409, { error: 'x', cars: [{ id: 'a', label: 'Ford Ka' }, { id: 1 }, null] })).toEqual({
      kind: 'blocked',
      cars: [{ id: 'a', label: 'Ford Ka' }],
    })
  })

  it('error con el mensaje del servidor o uno genérico', () => {
    expect(accountDeleteOutcome(502, { error: 'No pudimos borrar tus fotos.' })).toEqual({ kind: 'error', message: 'No pudimos borrar tus fotos.', closed: false })
    expect(accountDeleteOutcome(500, {})).toEqual({ kind: 'error', message: 'El servidor tuvo un problema (error 500). Probá de nuevo en un rato.', closed: false })
    expect(accountDeleteOutcome(200, null).kind).toBe('error')
  })

  it('error después de sacar la cuenta de allowlist', () => {
    expect(accountDeleteOutcome(500, { error: 'x', closed: true })).toEqual({ kind: 'error', message: 'x', closed: true })
  })
})

describe('accountPhotoRange', () => {
  it('abarca todo lo que empieza con la carpeta de la cuenta', () => {
    const { start, end } = accountPhotoRange('abc')
    expect(start).toBe('autocar/abc/')
    expect('autocar/abc/x1' >= start && 'autocar/abc/x1' < end).toBe(true)
    expect('autocar/abcd/x1' >= start && 'autocar/abcd/x1' < end).toBe(false)
    expect('autocar/ab/x1' >= start && 'autocar/ab/x1' < end).toBe(false)
  })
})

describe('photosToKeep', () => {
  it('conserva las fotos de la cuenta que usan autos de otras personas', () => {
    const keep = photosToKeep(
      [
        { ownerUid: 'other', photoPublicId: 'autocar/me-uid/a' },
        { ownerUid: ME, photoPublicId: 'autocar/me-uid/b' },
        { ownerUid: 'other', photoPublicId: 'autocar/other/c' },
        { ownerUid: 'other', photoPublicId: null },
      ],
      ME,
    )
    expect([...keep]).toEqual(['autocar/me-uid/a'])
  })
})

describe('imagesToDelete', () => {
  it('borra las de la carpeta menos las que se conservan, sin repetir', () => {
    const listed = ['autocar/me-uid/a', 'autocar/me-uid/b', 'autocar/me-uid/b', 'autocar/other/c']
    expect(imagesToDelete(listed, new Set(['autocar/me-uid/a']), ME)).toEqual(['autocar/me-uid/b'])
    expect(imagesToDelete([], new Set(), ME)).toEqual([])
  })
})

describe('chunks', () => {
  it('divide en partes de hasta el tamaño pedido', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunks([], 100)).toEqual([])
  })
})
