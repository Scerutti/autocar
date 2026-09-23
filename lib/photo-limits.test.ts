import { describe, expect, it } from 'vitest'
import { nextPhotoUsage } from './photo-limits'

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
