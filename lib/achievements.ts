import { addDays, addMonths, daysBetween, toISODate, weekdayOf } from './dates'
import { computeCostPerKm, computeFuelStats } from './fuel'
import type { AchievementRecord, Car, FuelLoad, ISODate, Job, MaintenanceRule, OdometerReading } from './types'

// Logros: catálogo central y reglas para saber si se cumplen. No depende de React ni de Firestore.
//
// Alcance: los logros son de la cuenta, pero cada condición se evalúa auto por auto, sin mezclar
// datos de autos distintos (3 trabajos en un auto + 2 en otro no son "5 trabajos"). Se guarda con
// qué auto se consiguió cada uno.

export type AchievementCategory = 'inicio' | 'constancia' | 'mantenimiento' | 'combustible' | 'gastos' | 'historial'

export const ACHIEVEMENT_CATEGORIES: { id: AchievementCategory; label: string; description: string }[] = [
  { id: 'inicio', label: 'Primeros pasos', description: 'Para arrancar con el pie derecho.' },
  { id: 'constancia', label: 'Constancia', description: 'Cargar los km una vez por semana.' },
  { id: 'mantenimiento', label: 'Mantenimiento', description: 'Lo que le hacés al auto.' },
  { id: 'combustible', label: 'Combustible', description: 'Cada carga suma.' },
  { id: 'gastos', label: 'Gastos', description: 'Anotar lo que se gasta, no gastar más.' },
  { id: 'historial', label: 'Historial', description: 'El auto, a lo largo del tiempo.' },
]

/** Datos de un auto, ya filtrados por auto y sin registros inválidos (ver `carRecords`). */
export interface CarRecords {
  car: Car
  rules: MaintenanceRule[]
  jobs: Job[]
  fuel: FuelLoad[]
  readings: OdometerReading[]
}

/** Cuánto lleva un auto hacia un logro. Se cumple cuando current >= target. */
export interface Progress {
  current: number
  target: number
  /** Lo que falta, en palabras, cuando no alcanza con "3 de 10" (p. ej. "Faltan 40 días"). */
  hint?: string
}

export interface AchievementDef {
  id: string
  name: string
  /** La condición, contada al usuario. */
  description: string
  category: AchievementCategory
  /** Hitos de 6 meses, 1 año y 2 años: celebración más destacada. */
  milestone?: boolean
  /** Para "3 de 10 trabajos"; sin unidad se muestra sólo el hint. */
  unit?: [singular: string, plural: string]
  progress: (r: CarRecords, today: ISODate) => Progress
}

// ---- Validación: sólo cuentan registros completos y con fecha real (no futura).

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const validDate = (date: unknown, today: ISODate): date is ISODate =>
  typeof date === 'string' && ISO_DATE.test(date) && date <= today

const isValidJob = (j: Job, today: ISODate) => validDate(j.date, today) && j.title.trim().length > 0
const isValidFuel = (f: FuelLoad, today: ISODate) => validDate(f.date, today) && f.quantity > 0
const isValidReading = (r: OdometerReading, today: ISODate) =>
  Number.isFinite(r.km) && r.km >= 0 && r.date.getTime() > 0 && toISODate(r.date) <= today

/** Separa los datos de cada auto, descartando los registros que no cuentan para los logros. */
export function carRecords(
  data: { cars: Car[]; rules: MaintenanceRule[]; jobs: Job[]; fuel: FuelLoad[]; odometer: OdometerReading[] },
  today: ISODate,
): CarRecords[] {
  return data.cars.map(car => ({
    car,
    rules: data.rules.filter(r => r.carId === car.id),
    jobs: data.jobs.filter(j => j.carId === car.id && isValidJob(j, today)),
    fuel: data.fuel.filter(f => f.carId === car.id && isValidFuel(f, today)),
    readings: data.odometer.filter(r => r.carId === car.id && isValidReading(r, today)),
  }))
}

// ---- Semanas y rachas
//
// Una semana va de lunes a domingo (fecha local). Cuenta si tiene al menos un registro de km (a mano,
// desde una carga o un trabajo, o el del alta del auto); varios registros en la misma semana cuentan
// una sola vez. Una racha son semanas seguidas con registro: si una semana queda sin registro, la racha
// vuelve a empezar (los logros ya conseguidos no se pierden). La semana en curso no corta la racha
// mientras no termine.

/** Lunes de la semana de una fecha. */
export function weekStart(date: ISODate): ISODate {
  return addDays(date, -((weekdayOf(date) + 6) % 7))
}

export interface WeekStats {
  /** Semanas distintas con registro. */
  weeks: number
  best: number
  /** Racha que sigue viva (termina esta semana o la anterior); 0 si ya se cortó. */
  current: number
}

export function weeklyStats(dates: ISODate[], today: ISODate): WeekStats {
  const weeks = [...new Set(dates.map(weekStart))].sort()
  let best = 0
  let run = 0
  for (let i = 0; i < weeks.length; i++) {
    run = i > 0 && addDays(weeks[i - 1], 7) === weeks[i] ? run + 1 : 1
    best = Math.max(best, run)
  }
  const last = weeks[weeks.length - 1]
  const alive = last != null && last >= addDays(weekStart(today), -7)
  return { weeks: weeks.length, best, current: alive ? run : 0 }
}

const readingWeeks = (r: CarRecords, today: ISODate) => weeklyStats(r.readings.map(x => toISODate(x.date)), today)

// ---- Reglas reutilizables

const count = (n: number, target: number): Progress => ({ current: Math.min(n, target), target })

/** Rachas: cuenta la mejor que tuvo; si todavía no llegó, muestra la que lleva ahora. */
function streak(target: number) {
  return (r: CarRecords, today: ISODate): Progress => {
    const s = readingWeeks(r, today)
    if (s.best >= target) return { current: target, target }
    return {
      current: s.current,
      target,
      hint: s.current === 0 && s.best > 0 ? 'La racha se cortó: cargá los km esta semana para retomarla.' : undefined,
    }
  }
}

/** Primer registro del auto en la app: el alta o la lectura de km más vieja. */
function trackingStart(r: CarRecords): ISODate | null {
  const instants = r.readings.map(x => x.date.getTime())
  if (r.car.createdAt.getTime() > 0) instants.push(r.car.createdAt.getTime())
  return instants.length ? toISODate(new Date(Math.min(...instants))) : null
}

function trackedDays(r: CarRecords, today: ISODate, years: number) {
  const start = trackingStart(r)
  if (!start) return { days: 0, target: Math.round(365.25 * years) }
  const target = daysBetween(start, addMonths(start, 12 * years))
  return { days: Math.max(0, Math.min(daysBetween(start, today), target)), target }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
const daysLeft = (n: number) => `${n === 1 ? 'Falta' : 'Faltan'} ${plural(n, 'día', 'días')}`

const OIL = /aceite|lubric/i
const VTV = /\bvtv\b|verificaci[oó]n t[eé]cnica/i
const INSURANCE = /seguro/i

/** Service o cambio de aceite: por categoría, por el título o por el mantenimiento que completó. */
function isOilChange(job: Job, rules: MaintenanceRule[]) {
  if (job.category === 'service' || OIL.test(job.title)) return true
  return rules.some(r => job.ruleIds.includes(r.id) && (OIL.test(r.name) || /service/i.test(r.name)))
}

const expenses = (r: CarRecords) => [
  ...r.jobs.filter(j => j.cost > 0).map(j => j.date),
  ...r.fuel.filter(f => f.total > 0).map(f => f.date),
]

/** Hay datos para el consumo (km/L, autos de un solo combustible) o el costo por km (nafta + GNC). */
function hasConsumption(r: CarRecords) {
  if (r.car.fuelTypes.length === 1) return computeFuelStats(r.fuel, r.car.fuelTypes[0], true).consumption != null
  return computeCostPerKm(r.fuel) != null
}

// ---- Catálogo
//
// Para agregar un logro: sumarlo acá (id estable: es el id del documento en Firestore) y darle un
// ícono en components/achievements/medal.tsx. No cambiar el id de uno existente.

const JOBS: [string, string] = ['trabajo', 'trabajos']
const LOADS: [string, string] = ['carga', 'cargas']
const WEEKS: [string, string] = ['semana', 'semanas']

export const ACHIEVEMENTS: AchievementDef[] = [
  // Primeros pasos
  {
    id: 'arrancamos',
    name: 'Arrancamos',
    description: 'Cargaste los km del auto por primera vez.',
    category: 'inicio',
    progress: r => count(r.readings.filter(x => x.source === 'manual').length, 1),
  },
  {
    id: 'primeros-auxilios',
    name: 'Primeros auxilios',
    description: 'Registraste tu primer trabajo en el auto.',
    category: 'inicio',
    progress: r => count(r.jobs.length, 1),
  },
  {
    id: 'primera-parada',
    name: 'Primera parada',
    description: 'Registraste tu primera carga de combustible.',
    category: 'inicio',
    progress: r => count(r.fuel.length, 1),
  },
  {
    id: 'de-estreno',
    name: 'De estreno',
    description: 'Completaste marca, modelo, año y patente del auto.',
    category: 'inicio',
    unit: ['dato', 'datos'],
    progress: r => {
      const fields = [r.car.brand.trim(), r.car.model.trim(), r.car.year, r.car.plate]
      const done = fields.filter(Boolean).length
      return { current: done, target: fields.length, hint: done < fields.length ? 'Completalo desde Editar auto.' : undefined }
    },
  },

  // Constancia
  {
    id: 'un-mes-sobre-ruedas',
    name: 'Un mes sobre ruedas',
    description: 'Cargaste los km 4 semanas seguidas.',
    category: 'constancia',
    unit: WEEKS,
    progress: streak(4),
  },
  {
    id: 'costumbre-de-garaje',
    name: 'Costumbre de garaje',
    description: 'Cargaste los km 12 semanas seguidas.',
    category: 'constancia',
    unit: WEEKS,
    progress: streak(12),
  },
  {
    id: 'copiloto-fiel',
    name: 'Copiloto fiel',
    description: 'Cargaste los km 26 semanas seguidas: medio año sin fallar.',
    category: 'constancia',
    milestone: true,
    unit: WEEKS,
    progress: streak(26),
  },
  {
    id: 'un-anio-de-ruta',
    name: 'Un año de ruta',
    description: 'Completaste 52 semanas con km cargados (no hace falta que sean seguidas).',
    category: 'constancia',
    milestone: true,
    unit: WEEKS,
    progress: (r, today) => count(readingWeeks(r, today).weeks, 52),
  },

  // Mantenimiento
  {
    id: 'corazon-sano',
    name: 'Corazón sano',
    description: 'Registraste un service o un cambio de aceite.',
    category: 'mantenimiento',
    progress: r => count(r.jobs.filter(j => isOilChange(j, r.rules)).length, 1),
  },
  {
    id: 'manos-a-la-obra',
    name: 'Manos a la obra',
    description: 'Registraste 3 trabajos en el auto.',
    category: 'mantenimiento',
    unit: JOBS,
    progress: r => count(r.jobs.length, 3),
  },
  {
    id: 'de-mecanico-a-experto',
    name: 'De mecánico a experto',
    description: 'Registraste 10 trabajos en el auto.',
    category: 'mantenimiento',
    unit: JOBS,
    progress: r => count(r.jobs.length, 10),
  },
  {
    id: 'historial-de-confianza',
    name: 'Historial de confianza',
    description: 'Registraste 25 trabajos en el auto.',
    category: 'mantenimiento',
    unit: JOBS,
    progress: r => count(r.jobs.length, 25),
  },
  {
    id: 'mejor-prevenir',
    name: 'Mejor prevenir',
    description: 'Registraste 5 trabajos marcando el mantenimiento que tocaba.',
    category: 'mantenimiento',
    unit: JOBS,
    progress: r => count(r.jobs.filter(j => j.ruleIds.length > 0).length, 5),
  },
  {
    id: 'nunca-mas-de-sorpresa',
    name: 'Nunca más de sorpresa',
    description: 'Tenés 3 mantenimientos con aviso configurados.',
    category: 'mantenimiento',
    unit: ['mantenimiento', 'mantenimientos'],
    progress: r => count(r.rules.length, 3),
  },

  // Combustible
  {
    id: 'tanque-bajo-control',
    name: 'Tanque bajo control',
    description: 'Registraste 10 cargas de combustible.',
    category: 'combustible',
    unit: LOADS,
    progress: r => count(r.fuel.length, 10),
  },
  {
    id: 'consumidor-consciente',
    name: 'Consumidor consciente',
    description: 'Registraste 30 cargas de combustible.',
    category: 'combustible',
    unit: LOADS,
    progress: r => count(r.fuel.length, 30),
  },
  {
    id: 'cada-gota-cuenta',
    name: 'Cada gota cuenta',
    description: 'Tus cargas ya alcanzan para ver el consumo del auto (o el costo por km, si anda a nafta + GNC).',
    category: 'combustible',
    progress: r => ({
      current: hasConsumption(r) ? 1 : 0,
      target: 1,
      hint: hasConsumption(r)
        ? undefined
        : r.car.fuelTypes.length === 1
          ? 'Hacen falta dos cargas de tanque lleno con km.'
          : 'Hacen falta dos cargas con km.',
    }),
  },

  // Gastos
  {
    id: 'ni-un-peso-perdido',
    name: 'Ni un peso perdido',
    description: 'Anotaste 5 gastos del auto (trabajos con costo o cargas).',
    category: 'gastos',
    unit: ['gasto', 'gastos'],
    progress: r => count(expenses(r).length, 5),
  },
  {
    id: 'cuentas-claras',
    name: 'Cuentas claras',
    description: 'Anotaste gastos en 3 meses distintos.',
    category: 'gastos',
    unit: ['mes', 'meses'],
    progress: r => count(new Set(expenses(r).map(d => d.slice(0, 7))).size, 3),
  },

  // Historial
  {
    id: 'memoria-de-elefante',
    name: 'Memoria de elefante',
    description: 'Registraste 20 trabajos con fecha, km y descripción.',
    category: 'historial',
    unit: JOBS,
    progress: r => count(r.jobs.filter(j => j.km != null).length, 20),
  },
  {
    id: 'papeles-en-orden',
    name: 'Papeles en orden',
    description: 'Cargaste la patente y los avisos de VTV y seguro.',
    category: 'historial',
    progress: r => {
      const parts = [
        { ok: Boolean(r.car.plate), label: 'la patente' },
        { ok: r.rules.some(x => VTV.test(x.name)), label: 'el aviso de VTV' },
        { ok: r.rules.some(x => INSURANCE.test(x.name)), label: 'el aviso del seguro' },
      ]
      const missing = parts.filter(p => !p.ok).map(p => p.label)
      return {
        current: parts.length - missing.length,
        target: parts.length,
        hint: missing.length ? `Falta ${missing.join(', ').replace(/, ([^,]*)$/, ' y $1')}.` : undefined,
      }
    },
  },
  {
    id: 'un-viejo-conocido',
    name: 'Un viejo conocido',
    description: 'Cumpliste un año siguiendo al auto en AutoCar.',
    category: 'historial',
    milestone: true,
    progress: (r, today) => {
      const { days, target } = trackedDays(r, today, 1)
      return { current: days, target, hint: days < target ? daysLeft(target - days) : undefined }
    },
  },
  {
    id: 'una-historia-sobre-ruedas',
    name: 'Una historia sobre ruedas',
    description: 'Dos años siguiendo al auto y al menos 20 trabajos o cargas registrados.',
    category: 'historial',
    milestone: true,
    progress: (r, today) => {
      const { days, target } = trackedDays(r, today, 2)
      const events = r.jobs.length + r.fuel.length
      const fraction = Math.min(days / target, events / 20, 1)
      const missing = [
        days < target ? plural(target - days, 'día', 'días') : null,
        events < 20 ? plural(20 - events, 'registro', 'registros') : null,
      ].filter(Boolean)
      return {
        current: Math.floor(fraction * 100),
        target: 100,
        hint: missing.length ? `${missing.length === 1 && missing[0]!.startsWith('1 ') ? 'Falta' : 'Faltan'} ${missing.join(' y ')}.` : undefined,
      }
    },
  },
]

export const ACHIEVEMENT_BY_ID = new Map(ACHIEVEMENTS.map(a => [a.id, a]))

// ---- Estado de cada logro

export type AchievementState = 'unlocked' | 'in-progress' | 'locked'

export interface AchievementStatus {
  def: AchievementDef
  /** Guardado en Firestore (el desbloqueo es permanente). */
  record: AchievementRecord | null
  /** Progreso del auto que va mejor. */
  progress: Progress
  /** Auto que lo cumple o que va mejor; null sin autos. */
  carId: string | null
  /** La condición se cumple ahora con los datos actuales. */
  met: boolean
  state: AchievementState
}

const ratio = (p: Progress) => (p.target > 0 ? p.current / p.target : 0)

export function evaluateAchievements(cars: CarRecords[], records: AchievementRecord[], today: ISODate): AchievementStatus[] {
  const recordById = new Map(records.map(r => [r.id, r]))
  return ACHIEVEMENTS.map(def => {
    let best: { progress: Progress; carId: string } | null = null
    for (const r of cars) {
      const progress = def.progress(r, today)
      if (!best || ratio(progress) > ratio(best.progress)) best = { progress, carId: r.car.id }
    }
    const progress = best?.progress ?? def.progress(EMPTY_CAR, today)
    const met = best != null && progress.current >= progress.target
    const record = recordById.get(def.id) ?? null
    const state: AchievementState = record ? 'unlocked' : progress.current > 0 ? 'in-progress' : 'locked'
    return { def, record, progress, carId: record?.carId ?? best?.carId ?? null, met, state }
  })
}

const EMPTY_CAR: CarRecords = {
  car: {
    id: '',
    brand: '',
    model: '',
    version: null,
    year: null,
    plate: null,
    fuelTypes: ['nafta'],
    currentKm: 0,
    kmUpdatedAt: null,
    avgKmPerDay: null,
    photoUrl: null,
    photoPublicId: null,
    createdAt: new Date(0),
  },
  rules: [],
  jobs: [],
  fuel: [],
  readings: [],
}

/** Logros que se cumplen y todavía no están guardados: los que hay que desbloquear. */
export function pendingUnlocks(statuses: AchievementStatus[]): { id: string; carId: string | null }[] {
  return statuses.filter(s => s.met && !s.record).map(s => ({ id: s.def.id, carId: s.carId }))
}

/** "3 de 10 trabajos", "Falta 1 día"… */
export function describeProgress(def: AchievementDef, p: Progress): string {
  if (p.current >= p.target) return 'Cumplido'
  if (def.unit && p.target > 1) return `${p.current} de ${p.target} ${def.unit[1]}`
  return p.hint ?? 'Pendiente'
}

// ---- Celebraciones

/**
 * Celebraciones pendientes, en el orden en que se desbloquearon (y, si fueron juntos, en el orden
 * del catálogo). Ignora ids que ya no están en el catálogo.
 */
export function pendingCelebrations(records: AchievementRecord[]): AchievementRecord[] {
  const order = new Map(ACHIEVEMENTS.map((a, i) => [a.id, i]))
  return records
    .filter(r => r.celebratedAt == null && order.has(r.id))
    .sort((a, b) => a.unlockedAt.getTime() - b.unlockedAt.getTime() || order.get(a.id)! - order.get(b.id)!)
}

export type CelebrationMode = 'single' | 'sequence' | 'summary'

/** Uno: celebración sola. De 2 a 4: de a uno ("1 de 3"). Cinco o más: primero un resumen. */
export function celebrationMode(count: number): CelebrationMode {
  return count <= 1 ? 'single' : count <= 4 ? 'sequence' : 'summary'
}

/**
 * Próximo logro alcanzable: el pendiente más avanzado. Los hitos (que llegan con el tiempo) van
 * después, así se sugiere algo que el usuario puede hacer ahora.
 */
export function nextAchievement(statuses: AchievementStatus[]): AchievementStatus | null {
  return (
    statuses
      .filter(s => s.state !== 'unlocked' && !s.met)
      .sort((a, b) => (a.def.milestone ? 1 : 0) - (b.def.milestone ? 1 : 0) || ratio(b.progress) - ratio(a.progress))[0] ?? null
  )
}

/** Último logro conseguido. */
export function latestAchievement(statuses: AchievementStatus[]): AchievementStatus | null {
  return (
    statuses
      .filter(s => s.record)
      .sort((a, b) => b.record!.unlockedAt.getTime() - a.record!.unlockedAt.getTime())[0] ?? null
  )
}
