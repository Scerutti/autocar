import { describe, expect, it } from 'vitest'
import { toISODate } from './dates'
import { carKmFrom, linkedReadingId, readingDateOf, readingOrigin, topReading, withLinkedReading } from './odometer'

const reading = (km: number, date: string) => ({ km, date: new Date(`${date}T12:00:00Z`) })

const point = (id: string, km: number, date: string) => ({ id, km, date: readingDateOf(date) })

describe('linkedReadingId', () => {
  it('arma el id con el origen y el id del registro', () => {
    expect(linkedReadingId('fuel', 'abc')).toBe('fuel-abc')
    expect(linkedReadingId('job', 'xyz')).toBe('job-xyz')
  })
  it('da siempre el mismo id para el mismo registro', () => {
    expect(linkedReadingId('fuel', 'abc')).toBe(linkedReadingId('fuel', 'abc'))
  })
})

describe('readingDateOf', () => {
  it('cae al mediodía local del mismo día, sin correrse al día anterior por el huso', () => {
    const d = readingDateOf('2026-03-12')
    expect(toISODate(d)).toBe('2026-03-12')
    expect(d.getHours()).toBe(12)
    expect(d.getMinutes()).toBe(0)
  })
  it('respeta el cambio de mes y de año', () => {
    expect(toISODate(readingDateOf('2026-01-01'))).toBe('2026-01-01')
    expect(toISODate(readingDateOf('2025-12-31'))).toBe('2025-12-31')
  })
})

describe('withLinkedReading', () => {
  const base = [point('initial', 10_000, '2026-01-01'), point('fuel-a', 150_000, '2026-03-12')]

  it('alta: suma la lectura nueva sin tocar las demás', () => {
    const next = point('fuel-b', 12_000, '2026-03-20')
    const out = withLinkedReading(base, 'fuel-b', next)
    expect(out).toHaveLength(3)
    expect(out).toContain(next)
    expect(base).toHaveLength(2)
  })
  it('cambio: reemplaza la lectura con el mismo id en vez de duplicarla', () => {
    const fixed = point('fuel-a', 15_000, '2026-03-12')
    const out = withLinkedReading(base, 'fuel-a', fixed)
    expect(out).toHaveLength(2)
    expect(out.filter(r => r.id === 'fuel-a')).toEqual([fixed])
  })
  it('baja: saca la lectura', () => {
    const out = withLinkedReading(base, 'fuel-a', null)
    expect(out.map(r => r.id)).toEqual(['initial'])
  })
  it('baja sin lectura previa: deja la lista como estaba', () => {
    expect(withLinkedReading(base, 'fuel-z', null)).toEqual(base)
  })
})

describe('readingOrigin', () => {
  const fuel = [{ id: 'f1', carId: 'c1', date: '2026-03-12' }]
  const jobs = [{ id: 'j1', carId: 'c1', title: 'Service' }]

  it('una lectura de una carga dice la fecha de la carga y lleva a ella', () => {
    expect(readingOrigin({ carId: 'c1', source: 'fuel', sourceId: 'f1' }, fuel, jobs)).toEqual({
      label: 'Carga del 12/03',
      href: '/autos/c1/combustible/f1',
    })
  })
  it('una lectura de un trabajo dice su título y lleva a él', () => {
    expect(readingOrigin({ carId: 'c1', source: 'job', sourceId: 'j1' }, fuel, jobs)).toEqual({
      label: 'Trabajo: Service',
      href: '/autos/c1/trabajos/j1',
    })
  })
  it('sin sourceId (manual, alta o vieja) no tiene origen', () => {
    expect(readingOrigin({ carId: 'c1', source: 'fuel', sourceId: null }, fuel, jobs)).toBeNull()
    expect(readingOrigin({ carId: 'c1', source: 'manual', sourceId: null }, fuel, jobs)).toBeNull()
  })
  it('si el registro no está en la app (o es de otro auto) no tiene origen', () => {
    expect(readingOrigin({ carId: 'c1', source: 'fuel', sourceId: 'f9' }, fuel, jobs)).toBeNull()
    expect(readingOrigin({ carId: 'c2', source: 'job', sourceId: 'j1' }, fuel, jobs)).toBeNull()
  })
})

describe('carKmFrom', () => {
  const now = new Date('2026-04-01T12:00:00')

  it('corregir una carga de 150.000 a 15.000 baja el km del auto al máximo real', () => {
    const base = [point('initial', 10_000, '2026-01-01'), point('fuel-a', 150_000, '2026-03-12')]
    expect(carKmFrom(base, now).currentKm).toBe(150_000)
    const fixed = withLinkedReading(base, 'fuel-a', point('fuel-a', 15_000, '2026-03-12'))
    const km = carKmFrom(fixed, now)
    expect(km.currentKm).toBe(15_000)
    expect(toISODate(km.kmUpdatedAt!)).toBe('2026-03-12')
  })
  it('borrar la carga vuelve el km a la lectura más alta que queda', () => {
    const base = [point('initial', 10_000, '2026-01-01'), point('fuel-a', 150_000, '2026-03-12')]
    const km = carKmFrom(withLinkedReading(base, 'fuel-a', null), now)
    expect(km.currentKm).toBe(10_000)
    expect(toISODate(km.kmUpdatedAt!)).toBe('2026-01-01')
  })
  it('una carga con fecha pasada y menos km entra en la serie y no baja el km del auto', () => {
    const base = [point('initial', 10_000, '2026-01-01'), point('manual', 20_000, '2026-03-20')]
    const out = withLinkedReading(base, 'fuel-old', point('fuel-old', 15_000, '2026-02-15'))
    expect(out).toHaveLength(3)
    expect(carKmFrom(out, now).currentKm).toBe(20_000)
  })
  it('sin lecturas da 0 y sin fecha', () => {
    expect(carKmFrom([], now)).toEqual({ currentKm: 0, kmUpdatedAt: null, avgKmPerDay: null })
  })
})

describe('topReading', () => {
  it('se queda con la lectura de más km aunque no vengan ordenadas', () => {
    const readings = [reading(50_000, '2026-09-01'), reading(50_500, '2026-09-03'), reading(50_200, '2026-09-02')]
    expect(topReading(readings)).toBe(readings[1])
  })
  it('manda el km aunque la lectura más alta tenga una fecha anterior', () => {
    const readings = [reading(50_500, '2026-09-01'), reading(50_200, '2026-09-05')]
    expect(topReading(readings)).toBe(readings[0])
  })
  it('ante un empate de km elige la más reciente, sin importar el orden', () => {
    const readings = [reading(50_000, '2026-09-01'), reading(50_000, '2026-09-10'), reading(50_000, '2026-09-05')]
    expect(topReading(readings)).toBe(readings[1])
    expect(topReading([...readings].reverse())).toBe(readings[1])
  })
  it('sin lecturas devuelve null', () => {
    expect(topReading([])).toBeNull()
  })
})
