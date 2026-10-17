import { describe, expect, it } from 'vitest'
import { NOVEDADES, unseenNovedades, type Novedad } from './novedades'

const list: Novedad[] = [
  { version: '1.10.0', date: '2026-12-01', items: [] },
  { version: '1.2.0', date: '2026-11-01', items: [] },
  { version: '1.0.0', date: '2026-10-09', items: [] },
]

const versions = (l: Novedad[]) => l.map(n => n.version)

describe('unseenNovedades', () => {
  it('cuenta las versiones posteriores a la última vista, comparando números y no texto', () => {
    expect(versions(unseenNovedades('1.2.0', null, list))).toEqual(['1.10.0'])
    expect(versions(unseenNovedades('1.0.0', '2020-01-01', list))).toEqual(['1.10.0', '1.2.0'])
    expect(unseenNovedades('1.10.0', null, list)).toEqual([])
  })

  it('sin nada visto, cuenta sólo lo que salió después de crear la cuenta', () => {
    expect(versions(unseenNovedades(null, '2026-10-20', list))).toEqual(['1.10.0', '1.2.0'])
    expect(unseenNovedades(null, '2026-12-05', list)).toEqual([])
  })

  it('sin fecha de la cuenta no anuncia nada', () => {
    expect(unseenNovedades(null, null, list)).toEqual([])
  })
})

describe('NOVEDADES', () => {
  it('va de la más nueva a la más vieja', () => {
    const dates = NOVEDADES.map(n => n.date)
    expect(dates).toEqual([...dates].sort().reverse())
  })
})
