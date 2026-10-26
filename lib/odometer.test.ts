import { describe, expect, it } from 'vitest'
import { toISODate } from './dates'
import { formatDate } from './format'
import {
  carKmFrom,
  entryKmWarning,
  kmAtDate,
  linkedReadingId,
  neighborsAt,
  readingDateOf,
  readingOrigin,
  topReading,
  validateKmReading,
  withLinkedReading,
} from './odometer'

const reading = (km: number, date: string) => ({ km, date: new Date(`${date}T12:00:00Z`) })

const point = (id: string, km: number, date: string) => ({ id, km, date: readingDateOf(date) })

/** Una lectura manual: guarda la hora local en que se cargó, no el mediodía. */
const manual = (id: string, km: number, date: string, time: string) => ({ id, km, date: new Date(`${date}T${time}`) })

describe('kmAtDate', () => {
  const series = [point('a', 40_000, '2026-01-01'), point('b', 46_000, '2026-03-01')]

  it('entre dos lecturas interpola por días y lo marca estimado (01/02 entre 40.000 y 46.000 ≈ 43.000)', () => {
    const out = kmAtDate(series, '2026-02-01')
    expect(out).toEqual({ km: 43_153, estimated: true })
    expect(Math.abs(out!.km - 43_000)).toBeLessThan(200)
  })
  it('el mismo día usa el km más alto de ese día y no es estimado', () => {
    const sameDay = [...series, manual('m1', 44_800, '2026-02-01', '08:15:00'), manual('m2', 45_000, '2026-02-01', '19:40:00')]
    expect(kmAtDate(sameDay, '2026-02-01')).toEqual({ km: 45_000, estimated: false })
  })
  it('compara por día local: una lectura manual de la noche es de ese día, no del siguiente', () => {
    const late = [point('a', 40_000, '2026-01-01'), manual('m', 41_000, '2026-01-10', '23:50:00')]
    expect(kmAtDate(late, '2026-01-10')).toEqual({ km: 41_000, estimated: false })
    expect(kmAtDate(late, '2026-01-11')).toEqual({ km: 41_000, estimated: true })
  })
  it('después de la última lectura da el km de la última, estimado (cota baja)', () => {
    expect(kmAtDate(series, '2026-05-10')).toEqual({ km: 46_000, estimated: true })
  })
  it('antes de la primera lectura no hay estimación', () => {
    expect(kmAtDate(series, '2025-12-31')).toBeNull()
  })
  it('sin lecturas no hay estimación', () => {
    expect(kmAtDate([], '2026-02-01')).toBeNull()
  })
  it('no depende del orden de las lecturas', () => {
    const shuffled = [point('c', 50_000, '2026-04-01'), series[1], point('z', 38_000, '2025-12-01'), series[0]]
    expect(kmAtDate(shuffled, '2026-02-01')).toEqual(kmAtDate(series, '2026-02-01'))
  })
  it('si la posterior tiene menos km que la anterior no interpola: da la anterior, estimado', () => {
    const broken = [point('a', 46_000, '2026-01-01'), point('b', 40_000, '2026-03-01')]
    expect(kmAtDate(broken, '2026-02-01')).toEqual({ km: 46_000, estimated: true })
  })
  it('la interpolación nunca da menos que la anterior', () => {
    const flat = [point('a', 40_000, '2026-01-01'), point('b', 40_001, '2026-12-31')]
    expect(kmAtDate(flat, '2026-01-02')!.km).toBeGreaterThanOrEqual(40_000)
  })
})

describe('neighborsAt', () => {
  const series = [point('a', 40_000, '2026-01-01'), point('b', 43_000, '2026-02-01'), point('c', 46_000, '2026-03-01')]

  it('da la lectura anterior y la posterior a la fecha', () => {
    const { before, after } = neighborsAt(series, '2026-02-15')
    expect(before?.id).toBe('b')
    expect(after?.id).toBe('c')
  })
  it('las del mismo día cuentan como anteriores', () => {
    const { before, after } = neighborsAt([...series, manual('m', 43_500, '2026-02-01', '21:00:00')], '2026-02-01')
    expect(before?.id).toBe('m')
    expect(after?.id).toBe('c')
  })
  it('antes de la primera no hay anterior; después de la última no hay posterior', () => {
    expect(neighborsAt(series, '2025-12-01')).toEqual({ before: null, after: series[0] })
    expect(neighborsAt(series, '2026-04-01')).toEqual({ before: series[2], after: null })
    expect(neighborsAt([], '2026-04-01')).toEqual({ before: null, after: null })
  })
  it('en una serie que no cierra, la anterior es la de más km y la posterior la de menos', () => {
    const broken = [point('a', 50_000, '2026-01-01'), point('b', 41_000, '2026-01-20'), point('c', 45_000, '2026-03-01'), point('d', 44_000, '2026-04-01')]
    const { before, after } = neighborsAt(broken, '2026-02-01')
    expect(before?.id).toBe('a')
    expect(after?.id).toBe('d')
  })
})

describe('validateKmReading', () => {
  const series = [point('a', 48_200, '2026-03-12'), point('b', 49_000, '2026-03-20')]

  it('acepta un km con fecha pasada que entra entre las vecinas', () => {
    expect(validateKmReading(48_500, '2026-03-15', series)).toEqual({ ok: true })
  })
  it('rechaza menos que la anterior y nombra su fecha y su km', () => {
    const v = validateKmReading(48_100, '2026-03-15', series)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.error).toContain(formatDate('2026-03-12'))
    expect(!v.ok && v.error).toContain('48.200 km')
  })
  it('rechaza más que la posterior y nombra su fecha y su km', () => {
    const v = validateKmReading(49_100, '2026-03-15', series)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.error).toContain(formatDate('2026-03-20'))
    expect(!v.ok && v.error).toContain('49.000 km')
  })
  it('el mismo km que la vecina se acepta', () => {
    expect(validateKmReading(48_200, '2026-03-15', series).ok).toBe(true)
    expect(validateKmReading(49_000, '2026-03-15', series).ok).toBe(true)
  })
  it('una lectura del mismo día cuenta como anterior', () => {
    expect(validateKmReading(48_100, '2026-03-12', series).ok).toBe(false)
    expect(validateKmReading(48_200, '2026-03-12', series).ok).toBe(true)
    expect(validateKmReading(48_300, '2026-03-12', series).ok).toBe(true)
  })
  it('con la fecha de hoy es como siempre: no menos que el km actual', () => {
    expect(validateKmReading(48_900, '2026-03-25', series).ok).toBe(false)
    expect(validateKmReading(49_000, '2026-03-25', series).ok).toBe(true)
  })
  it('antes de la primera lectura sólo acota por arriba', () => {
    expect(validateKmReading(10_000, '2026-01-01', series).ok).toBe(true)
    expect(validateKmReading(48_300, '2026-01-01', series).ok).toBe(false)
  })
  it('rechaza lo que no es un entero', () => {
    expect(validateKmReading(48_500.5, '2026-03-15', series).ok).toBe(false)
    expect(validateKmReading(-1, '2026-03-15', []).ok).toBe(false)
  })
})

describe('entryKmWarning: coherencia con la serie', () => {
  const car = { currentKm: 46_000, kmUpdatedAt: readingDateOf('2026-03-15') }
  const series = [point('a', 40_000, '2026-03-01'), point('b', 46_000, '2026-03-15')]

  it('una carga del 01/03 con más km que una lectura del 15/03 avisa (sin bloquear)', () => {
    const w = entryKmWarning({ date: '2026-03-01', km: 47_000, isNew: true }, car, series)
    expect(w).toContain(formatDate('2026-03-15'))
    expect(w).toContain('46.000 km')
    expect(entryKmWarning({ date: '2026-03-05', km: 46_500, isNew: true }, car, series)).toContain('46.000 km')
  })
  it('avisa si tiene menos km que una lectura de antes', () => {
    const w = entryKmWarning({ date: '2026-03-10', km: 39_000, isNew: true }, car, series)
    expect(w).toContain(formatDate('2026-03-01'))
    expect(w).toContain('40.000 km')
  })
  it('km que entran en la serie no avisan', () => {
    expect(entryKmWarning({ date: '2026-03-10', km: 43_000, isNew: true }, car, series)).toBeNull()
  })
  it('al editar no cuenta la lectura del propio registro', () => {
    const withOwn = [...series, point(linkedReadingId('fuel', 'f1'), 50_000, '2026-03-05')]
    const editing = { date: '2026-03-10', km: 43_000, isNew: false, readingId: linkedReadingId('fuel', 'f1') }
    expect(entryKmWarning(editing, car, withOwn)).toBeNull()
    expect(entryKmWarning({ ...editing, readingId: null }, car, withOwn)).toMatch(/50\.000 km/)
  })
  it('lo mismo con la lectura de un trabajo', () => {
    const withOwn = [...series, point(linkedReadingId('job', 'j1'), 30_000, '2026-03-12')]
    const editing = { date: '2026-03-10', km: 43_000, isNew: false, readingId: linkedReadingId('job', 'j1') }
    expect(entryKmWarning(editing, car, withOwn)).toBeNull()
  })
})

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
