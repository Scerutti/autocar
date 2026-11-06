import { describe, expect, it } from 'vitest'
import { groupByCar } from './by-car'

const rec = (id: string, carId: string) => ({ id, carId })

describe('groupByCar', () => {
  it('reparte cada registro en su auto conservando el orden', () => {
    const byCar = groupByCar(['a', 'b'], {
      rules: [rec('r1', 'a'), rec('r2', 'b'), rec('r3', 'a')],
      jobs: [rec('j3', 'b'), rec('j2', 'a'), rec('j1', 'a')],
      fuel: [rec('f2', 'a'), rec('f1', 'b'), rec('f0', 'a')],
      readings: [rec('o1', 'b'), rec('o2', 'b'), rec('o3', 'a')],
    })
    expect(byCar.get('a')).toEqual({
      rules: [rec('r1', 'a'), rec('r3', 'a')],
      jobs: [rec('j2', 'a'), rec('j1', 'a')],
      fuel: [rec('f2', 'a'), rec('f0', 'a')],
      readings: [rec('o3', 'a')],
    })
    expect(byCar.get('b')).toEqual({
      rules: [rec('r2', 'b')],
      jobs: [rec('j3', 'b')],
      fuel: [rec('f1', 'b')],
      readings: [rec('o1', 'b'), rec('o2', 'b')],
    })
  })

  it('conserva los mismos objetos', () => {
    const job = rec('j1', 'a')
    expect(groupByCar(['a'], { rules: [], jobs: [job], fuel: [], readings: [] }).get('a')!.jobs[0]).toBe(job)
  })

  it('da listas vacías a un auto sin registros', () => {
    const byCar = groupByCar(['a', 'vacio'], { rules: [rec('r1', 'a')], jobs: [], fuel: [], readings: [] })
    expect(byCar.get('vacio')).toEqual({ rules: [], jobs: [], fuel: [], readings: [] })
    expect([...byCar.keys()]).toEqual(['a', 'vacio'])
  })

  it('deja afuera los registros de un auto desconocido', () => {
    const byCar = groupByCar(['a'], {
      rules: [rec('r1', 'otro')],
      jobs: [rec('j1', 'otro'), rec('j2', 'a')],
      fuel: [rec('f1', 'otro')],
      readings: [rec('o1', 'otro')],
    })
    expect([...byCar.keys()]).toEqual(['a'])
    expect(byCar.get('a')).toEqual({ rules: [], jobs: [rec('j2', 'a')], fuel: [], readings: [] })
    expect(byCar.has('otro')).toBe(false)
  })

  it('sin autos da un mapa vacío', () => {
    expect(groupByCar([], { rules: [rec('r1', 'a')], jobs: [], fuel: [], readings: [] }).size).toBe(0)
  })
})
