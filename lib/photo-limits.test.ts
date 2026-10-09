import { describe, expect, it } from 'vitest'
import { isOwnPublicId, nextPhotoUsage } from './photo-limits'

describe('nextPhotoUsage', () => {
  it('cuenta las fotos del día', () => {
    expect(nextPhotoUsage(undefined, '2026-09-23', 3)).toEqual({ day: '2026-09-23', photos: 1 })
    expect(nextPhotoUsage({ day: '2026-09-23', photos: 2 }, '2026-09-23', 3)).toEqual({ day: '2026-09-23', photos: 3 })
  })
  it('corta al llegar al máximo', () => {
    expect(nextPhotoUsage({ day: '2026-09-23', photos: 3 }, '2026-09-23', 3)).toBeNull()
  })
  it('arranca de cero al día siguiente', () => {
    expect(nextPhotoUsage({ day: '2026-09-22', photos: 3 }, '2026-09-23', 3)).toEqual({ day: '2026-09-23', photos: 1 })
  })
})

describe('isOwnPublicId', () => {
  const folder = 'autocar/uid123'
  it('acepta las fotos de la carpeta del usuario', () => {
    expect(isOwnPublicId('autocar/uid123/0b7c1e4a-2f3d-4c5b-9a8e-1d2c3b4a5f6e', folder)).toBe(true)
    // ids viejos, al azar de Cloudinary
    expect(isOwnPublicId('autocar/uid123/x8kq2ymzv0abcdef', folder)).toBe(true)
  })
  it('rechaza otras carpetas', () => {
    expect(isOwnPublicId('autocar/otro/foto', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid1234/foto', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid123', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid123/', folder)).toBe(false)
  })
  it('rechaza ids con caracteres raros', () => {
    expect(isOwnPublicId('autocar/uid123/../otro/foto', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid123//foto', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid123/foto\\otra', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid123/foto.jpg', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid123/foto otra', folder)).toBe(false)
    expect(isOwnPublicId('autocar/uid123/fotó', folder)).toBe(false)
  })
  it('rechaza lo que no es un id', () => {
    expect(isOwnPublicId(undefined, folder)).toBe(false)
    expect(isOwnPublicId(123, folder)).toBe(false)
    expect(isOwnPublicId(`autocar/uid123/${'a'.repeat(300)}`, folder)).toBe(false)
  })
})
