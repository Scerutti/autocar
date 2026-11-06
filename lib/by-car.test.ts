import { describe, expect, it } from 'vitest'
import { groupByCar } from './by-car'

const rec = (id: string, carId: string) => ({ id, carId })

describe('groupByCar', () => {
  it('reparte cada registro en su auto conservando el orden', () => {
    const byCar = groupByCar(['a', 'b'], [rec('j3', 'b'), rec('j2', 'a'), rec('j1', 'a'), rec('j0', 'b')])
    expect(byCar.get('a')).toEqual([rec('j2', 'a'), rec('j1', 'a')])
    expect(byCar.get('b')).toEqual([rec('j3', 'b'), rec('j0', 'b')])
  })

  it('conserva los mismos objetos', () => {
    const job = rec('j1', 'a')
    expect(groupByCar(['a'], [job]).get('a')![0]).toBe(job)
  })

  it('da una lista vacía a un auto sin registros', () => {
    const byCar = groupByCar(['a', 'vacio'], [rec('r1', 'a')])
    expect(byCar.get('vacio')).toEqual([])
    expect([...byCar.keys()]).toEqual(['a', 'vacio'])
  })

  it('deja afuera los registros de un auto desconocido', () => {
    const byCar = groupByCar(['a'], [rec('j1', 'otro'), rec('j2', 'a')])
    expect([...byCar.keys()]).toEqual(['a'])
    expect(byCar.get('a')).toEqual([rec('j2', 'a')])
    expect(byCar.has('otro')).toBe(false)
  })

  it('sin autos da un mapa vacío', () => {
    expect(groupByCar([], [rec('r1', 'a')]).size).toBe(0)
  })
})
