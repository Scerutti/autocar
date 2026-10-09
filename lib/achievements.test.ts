import { describe, expect, it } from 'vitest'
import {
  ACHIEVEMENTS,
  carRecords,
  celebrationMode,
  describeProgress,
  evaluateAchievements,
  nextAchievement,
  pendingCelebrations,
  pendingUnlocks,
  weeklyStats,
  weekStart,
} from './achievements'
import { addDays } from './dates'
import type { AchievementRecord, Car, FuelLoad, Job, MaintenanceRule, OdometerReading } from './types'

const TODAY = '2026-10-09' // viernes

const car = (extra: Partial<Car> = {}): Car => ({
  id: 'c1',
  brand: 'Fiat',
  model: 'Cronos',
  version: null,
  year: null,
  plate: null,
  fuelTypes: ['nafta'],
  currentKm: 0,
  kmUpdatedAt: null,
  avgKmPerDay: null,
  photoUrl: null,
  photoPublicId: null,
  createdAt: new Date('2026-06-01T12:00:00'),
  ...extra,
})

let seq = 0
const job = (extra: Partial<Job> = {}): Job => ({
  id: `j${++seq}`,
  carId: 'c1',
  date: '2026-09-01',
  km: 10000,
  title: 'Cambio de cubiertas',
  category: 'cubiertas',
  cost: 0,
  workshop: null,
  notes: null,
  ruleIds: [],
  createdAt: new Date(`2026-09-01T12:00:${String(seq % 60).padStart(2, '0')}`),
  ...extra,
})

const fuel = (extra: Partial<FuelLoad> = {}): FuelLoad => ({
  id: `f${++seq}`,
  carId: 'c1',
  date: '2026-09-01',
  km: null,
  fuelType: 'nafta',
  grade: 'super',
  quantity: 40,
  unitPrice: 1000,
  total: 40000,
  fullTank: true,
  station: null,
  createdAt: new Date('2026-09-01T12:00:00'),
  ...extra,
})

const reading = (date: string, extra: Partial<OdometerReading> = {}): OdometerReading => ({
  id: `r${++seq}`,
  carId: 'c1',
  km: 10000 + seq,
  date: new Date(`${date}T12:00:00`),
  source: 'manual',
  ...extra,
})

const rule = (name: string, extra: Partial<MaintenanceRule> = {}): MaintenanceRule => ({
  id: `rule${++seq}`,
  carId: 'c1',
  name,
  intervalKm: null,
  intervalTime: { amount: 1, unit: 'year' },
  repeat: true,
  lastDoneKm: null,
  lastDoneDate: '2026-01-01',
  warnKm: 500,
  warnDays: 30,
  lastNotifiedAt: null,
  lastNotifiedStatus: null,
  ...extra,
})

const record = (id: string, extra: Partial<AchievementRecord> = {}): AchievementRecord => ({
  id,
  carId: 'c1',
  unlockedAt: new Date('2026-10-01T10:00:00'),
  celebratedAt: null,
  ...extra,
})

function evaluate(
  data: { cars?: Car[]; rules?: MaintenanceRule[]; jobs?: Job[]; fuel?: FuelLoad[]; odometer?: OdometerReading[] },
  records: AchievementRecord[] = [],
  today = TODAY,
) {
  const all = { cars: [car()], rules: [], jobs: [], fuel: [], odometer: [], ...data }
  return evaluateAchievements(carRecords(all, today), records, today)
}

const find = (statuses: ReturnType<typeof evaluate>, id: string) => statuses.find(s => s.def.id === id)!
const metIds = (statuses: ReturnType<typeof evaluate>) => statuses.filter(s => s.met).map(s => s.def.id)

/** Una lectura por semana, `n` semanas seguidas terminando en la semana de `last`. */
const weeklyReadings = (n: number, last = TODAY) => Array.from({ length: n }, (_, i) => reading(addDays(last, -7 * (n - 1 - i))))

describe('catálogo', () => {
  it('tiene ids únicos y estables', () => {
    const ids = ACHIEVEMENTS.map(a => a.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toHaveLength(23)
  })

  it('sin autos no se cumple ninguno', () => {
    const s = evaluateAchievements([], [], TODAY)
    expect(metIds(s)).toEqual([])
    expect(s.every(x => x.state === 'locked' || x.state === 'in-progress')).toBe(true)
  })
})

describe('semanas y rachas', () => {
  it('la semana empieza el lunes', () => {
    expect(weekStart('2026-10-09')).toBe('2026-10-05') // viernes
    expect(weekStart('2026-10-05')).toBe('2026-10-05') // lunes
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // domingo
  })

  it('varios registros en la misma semana cuentan una vez', () => {
    expect(weeklyStats(['2026-10-05', '2026-10-07', '2026-10-11'], TODAY)).toEqual({ weeks: 1, best: 1, current: 1 })
  })

  it('la racha sigue a través del cambio de año', () => {
    // miércoles 31/12/2025 cae en la semana del lunes 29/12; el 5/1/2026 es el lunes siguiente
    expect(weeklyStats(['2025-12-22', '2025-12-31', '2026-01-05'], '2026-01-06')).toEqual({ weeks: 3, best: 3, current: 3 })
  })

  it('una semana sin registro corta la racha pero no borra la mejor', () => {
    const s = weeklyStats(['2026-09-07', '2026-09-14', '2026-09-21', '2026-10-05'], TODAY)
    expect(s).toEqual({ weeks: 4, best: 3, current: 1 })
  })

  it('la semana en curso sin registro todavía no corta la racha', () => {
    expect(weeklyStats(['2026-09-21', '2026-09-28'], TODAY).current).toBe(2)
    expect(weeklyStats(['2026-09-14', '2026-09-21'], TODAY).current).toBe(0)
  })

  it('4 semanas seguidas dan "Un mes sobre ruedas"; con un hueco no', () => {
    expect(find(evaluate({ odometer: weeklyReadings(4) }), 'un-mes-sobre-ruedas').met).toBe(true)
    const withGap = weeklyReadings(5).filter((_, i) => i !== 2)
    const s = find(evaluate({ odometer: withGap }), 'un-mes-sobre-ruedas')
    expect(s.met).toBe(false)
    expect(s.progress.current).toBe(2)
  })

  it('cargar km todos los días no adelanta la racha', () => {
    const daily = Array.from({ length: 14 }, (_, i) => reading(addDays(TODAY, -i)))
    expect(find(evaluate({ odometer: daily }), 'un-mes-sobre-ruedas').progress.current).toBe(3)
  })

  it('"Un año de ruta" cuenta semanas con registro aunque no sean seguidas', () => {
    const everyOther = Array.from({ length: 52 }, (_, i) => reading(addDays(TODAY, -14 * i)))
    const s = evaluate({ odometer: everyOther })
    expect(find(s, 'un-anio-de-ruta').met).toBe(true)
    expect(find(s, 'un-mes-sobre-ruedas').met).toBe(false)
  })
})

describe('primeros desbloqueos y umbrales', () => {
  it('el km del alta no cuenta como "Arrancamos"; una carga manual sí', () => {
    expect(find(evaluate({ odometer: [reading('2026-06-01', { source: 'initial' })] }), 'arrancamos').met).toBe(false)
    expect(find(evaluate({ odometer: [reading('2026-10-01')] }), 'arrancamos').met).toBe(true)
  })

  it('los trabajos acumulan hasta el umbral', () => {
    const two = find(evaluate({ jobs: [job(), job()] }), 'manos-a-la-obra')
    expect(two.met).toBe(false)
    expect(two.state).toBe('in-progress')
    expect(describeProgress(two.def, two.progress)).toBe('2 de 3 trabajos')
    expect(find(evaluate({ jobs: [job(), job(), job()] }), 'manos-a-la-obra').met).toBe(true)
  })

  it('una sola operación puede cumplir varios a la vez, en el orden del catálogo', () => {
    const first = job({ title: 'Service', category: 'service', cost: 50000 })
    const unlocks = pendingUnlocks(evaluate({ jobs: [first] })).map(u => u.id)
    expect(unlocks).toEqual(['primeros-auxilios', 'corazon-sano'])
  })

  it('"De estreno" pide marca, modelo, año y patente', () => {
    const partial = find(evaluate({ cars: [car({ year: 2020 })] }), 'de-estreno')
    expect(partial.met).toBe(false)
    expect(describeProgress(partial.def, partial.progress)).toBe('3 de 4 datos')
    expect(find(evaluate({ cars: [car({ year: 2020, plate: 'AB123CD' })] }), 'de-estreno').met).toBe(true)
  })

  it('reconoce el cambio de aceite por categoría, título o mantenimiento completado', () => {
    const service = rule('Service')
    expect(find(evaluate({ jobs: [job({ title: 'Cambio de aceite y filtro' })] }), 'corazon-sano').met).toBe(true)
    expect(find(evaluate({ rules: [service], jobs: [job({ title: 'Taller', ruleIds: [service.id] })] }), 'corazon-sano').met).toBe(true)
    expect(find(evaluate({ jobs: [job({ title: 'Lavado' })] }), 'corazon-sano').met).toBe(false)
  })

  it('"Mejor prevenir" cuenta los trabajos que completaron un mantenimiento', () => {
    const jobs = [...Array.from({ length: 4 }, () => job({ ruleIds: ['x'] })), job()]
    expect(find(evaluate({ jobs }), 'mejor-prevenir').progress.current).toBe(4)
    expect(find(evaluate({ jobs: [...jobs, job({ ruleIds: ['y'] })] }), 'mejor-prevenir').met).toBe(true)
  })
})

describe('combustible y gastos', () => {
  it('"Cada gota cuenta" sólo cuando el consumo se puede calcular', () => {
    const one = [fuel({ km: 10000 })]
    expect(find(evaluate({ fuel: one }), 'cada-gota-cuenta').met).toBe(false)
    const two = [fuel({ km: 10000, date: '2026-09-01' }), fuel({ km: 10500, date: '2026-09-10' })]
    expect(find(evaluate({ fuel: two }), 'cada-gota-cuenta').met).toBe(true)
    // Sin tanque lleno no hay consumo confiable
    const notFull = two.map(f => ({ ...f, fullTank: false }))
    expect(find(evaluate({ fuel: notFull }), 'cada-gota-cuenta').met).toBe(false)
  })

  it('en autos a nafta + GNC usa el costo por km', () => {
    const dual = car({ fuelTypes: ['nafta', 'gnc'] })
    const loads = [fuel({ km: 10000 }), fuel({ km: 10300, fuelType: 'gnc', grade: null, date: '2026-09-05' })]
    expect(find(evaluate({ cars: [dual], fuel: loads }), 'cada-gota-cuenta').met).toBe(true)
  })

  it('"Cuentas claras" cuenta meses distintos, también entre años', () => {
    const jobs = [job({ date: '2025-12-15', cost: 100 }), job({ date: '2025-12-20', cost: 100 })]
    const loads = [fuel({ date: '2026-01-03' })]
    expect(find(evaluate({ jobs, fuel: loads }), 'cuentas-claras').progress.current).toBe(2)
    expect(find(evaluate({ jobs, fuel: [...loads, fuel({ date: '2026-02-01' })] }), 'cuentas-claras').met).toBe(true)
  })

  it('los trabajos sin costo no cuentan como gasto', () => {
    const jobs = Array.from({ length: 5 }, () => job({ cost: 0 }))
    expect(find(evaluate({ jobs }), 'ni-un-peso-perdido').progress.current).toBe(0)
  })
})

describe('datos inválidos', () => {
  it('ignora registros con fecha futura, sin título o sin cantidad', () => {
    const jobs = [job({ date: '2026-10-10' }), job({ title: '   ' }), job({ date: 'ayer' })]
    const loads = [fuel({ quantity: 0 }), fuel({ date: '2027-01-01' })]
    const readings = [reading('2026-12-01')]
    const s = evaluate({ jobs, fuel: loads, odometer: readings })
    expect(find(s, 'primeros-auxilios').met).toBe(false)
    expect(find(s, 'primera-parada').met).toBe(false)
    expect(find(s, 'arrancamos').met).toBe(false)
  })

  it('"Memoria de elefante" exige trabajos con km', () => {
    const jobs = Array.from({ length: 20 }, (_, i) => job({ km: i < 19 ? 1000 : null }))
    expect(find(evaluate({ jobs }), 'memoria-de-elefante').progress.current).toBe(19)
  })
})

describe('aislamiento entre autos', () => {
  it('no suma registros de autos distintos y elige el auto que va mejor', () => {
    const c2 = car({ id: 'c2' })
    const jobs = [job(), job(), job({ carId: 'c2' })]
    const s = find(evaluate({ cars: [car(), c2], jobs }), 'manos-a-la-obra')
    expect(s.met).toBe(false)
    expect(s.progress.current).toBe(2)
    expect(s.carId).toBe('c1')
  })

  it('guarda con qué auto se consiguió', () => {
    const c2 = car({ id: 'c2' })
    const unlocks = pendingUnlocks(evaluate({ cars: [car(), c2], fuel: [fuel({ carId: 'c2' })] }))
    expect(unlocks.find(u => u.id === 'primera-parada')).toEqual({ id: 'primera-parada', carId: 'c2' })
  })

  it('ignora registros de autos que ya no existen', () => {
    expect(find(evaluate({ jobs: [job({ carId: 'borrado' })] }), 'primeros-auxilios').met).toBe(false)
  })
})

describe('permanencia e idempotencia', () => {
  it('no vuelve a pedir el desbloqueo de uno ya guardado', () => {
    const s = evaluate({ jobs: [job()] }, [record('primeros-auxilios')])
    expect(pendingUnlocks(s).map(u => u.id)).not.toContain('primeros-auxilios')
  })

  it('evaluar dos veces lo mismo da los mismos desbloqueos (sin duplicados)', () => {
    const data = { jobs: [job(), job(), job()] }
    const a = pendingUnlocks(evaluate(data))
    expect(pendingUnlocks(evaluate(data))).toEqual(a)
    expect(new Set(a.map(u => u.id)).size).toBe(a.length)
  })

  it('sigue desbloqueado aunque después se borren los registros', () => {
    const s = find(evaluate({ jobs: [] }, [record('manos-a-la-obra')]), 'manos-a-la-obra')
    expect(s.state).toBe('unlocked')
    expect(s.met).toBe(false)
  })

  it('editar un registro no lo repite', () => {
    const edited = job({ title: 'Otro título', date: '2026-08-01' })
    expect(pendingUnlocks(evaluate({ jobs: [edited] }, [record('primeros-auxilios')]))).toEqual([])
  })
})

describe('seguimiento a largo plazo', () => {
  it('"Un viejo conocido" se cumple el día del aniversario', () => {
    const c = car({ createdAt: new Date('2025-10-09T12:00:00') })
    expect(find(evaluate({ cars: [c] }), 'un-viejo-conocido').met).toBe(true)
    const dayBefore = find(evaluate({ cars: [c] }, [], '2026-10-08'), 'un-viejo-conocido')
    expect(dayBefore.met).toBe(false)
    expect(dayBefore.progress.hint).toBe('Falta 1 día')
  })

  it('cuenta desde la lectura de km más vieja si es anterior al alta', () => {
    const c = car({ createdAt: new Date('2026-06-01T12:00:00') })
    const old = reading('2025-10-01', { source: 'initial' })
    expect(find(evaluate({ cars: [c], odometer: [old] }), 'un-viejo-conocido').met).toBe(true)
  })

  it('"Una historia sobre ruedas" necesita dos años y 20 registros', () => {
    const c = car({ createdAt: new Date('2024-10-01T12:00:00') })
    const few = find(evaluate({ cars: [c], jobs: [job()] }), 'una-historia-sobre-ruedas')
    expect(few.met).toBe(false)
    expect(few.progress.hint).toBe('Faltan 19 registros.')
    const jobs = Array.from({ length: 12 }, () => job())
    const loads = Array.from({ length: 8 }, () => fuel())
    expect(find(evaluate({ cars: [c], jobs, fuel: loads }), 'una-historia-sobre-ruedas').met).toBe(true)
  })

  it('"Papeles en orden" dice qué falta', () => {
    const s = find(evaluate({ cars: [car({ plate: 'AB123CD' })], rules: [rule('VTV')] }), 'papeles-en-orden')
    expect(s.met).toBe(false)
    expect(s.progress.hint).toBe('Falta el aviso del seguro.')
    const all = evaluate({ cars: [car({ plate: 'AB123CD' })], rules: [rule('VTV'), rule('Seguro del auto')] })
    expect(find(all, 'papeles-en-orden').met).toBe(true)
  })
})

describe('próximo logro', () => {
  it('sugiere algo que se pueda hacer antes que un hito que llega con el tiempo', () => {
    const c = car({ createdAt: new Date('2025-11-01T12:00:00') }) // casi un año: "Un viejo conocido" va por el 90 %
    const next = nextAchievement(evaluate({ cars: [c], jobs: [job(), job()] }))
    expect(next?.def.id).toBe('manos-a-la-obra')
  })
})

describe('celebraciones', () => {
  it('pendientes en orden de desbloqueo y, si fueron juntos, del catálogo', () => {
    const t1 = new Date('2026-10-01T10:00:00')
    const t2 = new Date('2026-10-02T10:00:00')
    const records = [
      record('manos-a-la-obra', { unlockedAt: t2 }),
      record('corazon-sano', { unlockedAt: t1 }),
      record('primeros-auxilios', { unlockedAt: t1 }),
      record('arrancamos', { unlockedAt: t1, celebratedAt: t2 }),
      record('logro-que-ya-no-existe', { unlockedAt: t1 }),
    ]
    expect(pendingCelebrations(records).map(r => r.id)).toEqual(['primeros-auxilios', 'corazon-sano', 'manos-a-la-obra'])
  })

  it('una procesada no vuelve a aparecer', () => {
    expect(pendingCelebrations([record('arrancamos', { celebratedAt: new Date() })])).toEqual([])
  })

  it('elige el formato según la cantidad', () => {
    expect(celebrationMode(1)).toBe('single')
    expect(celebrationMode(2)).toBe('sequence')
    expect(celebrationMode(4)).toBe('sequence')
    expect(celebrationMode(5)).toBe('summary')
    expect(celebrationMode(12)).toBe('summary')
  })
})
