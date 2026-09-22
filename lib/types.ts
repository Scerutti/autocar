// Fechas "de calendario" (sin hora) se guardan como 'YYYY-MM-DD'.
// Instantes (cuándo se cargó algo) se manejan como Date y en Firestore como Timestamp.
export type ISODate = string

// Un auto anda a nafta, o a nafta + GNC (no hay autos sólo a GNC). La nafta puede ser súper o premium.
export type FuelType = 'nafta' | 'gnc'
export type NaftaGrade = 'super' | 'premium'

export const FUEL_LABELS: Record<FuelType, string> = { nafta: 'Nafta', gnc: 'GNC' }
export const FUEL_UNITS: Record<FuelType, string> = { nafta: 'L', gnc: 'm³' }
export const NAFTA_GRADE_LABELS: Record<NaftaGrade, string> = { super: 'Súper', premium: 'Premium' }

export type IntervalUnit = 'day' | 'week' | 'month' | 'year'

/** Un lapso de tiempo: "3 semanas", "6 meses", "1 año". */
export interface TimeInterval {
  amount: number
  unit: IntervalUnit
}

export interface Car {
  id: string
  brand: string
  model: string
  version: string | null
  year: number | null
  plate: string | null
  fuelTypes: FuelType[]
  currentKm: number
  kmUpdatedAt: Date | null
  avgKmPerDay: number | null
  photoUrl: string | null
  photoPublicId: string | null
  createdAt: Date
}

export interface MaintenanceRule {
  id: string
  carId: string
  name: string
  intervalKm: number | null
  /** Cada cuánto tiempo; si no se repite, dentro de cuánto. */
  intervalTime: TimeInterval | null
  /**
   * false = recordatorio de una sola vez (p. ej. "volver al taller en 3 semanas"):
   * cuando se hace, se borra en vez de reiniciarse.
   */
  repeat: boolean
  lastDoneKm: number | null
  lastDoneDate: ISODate | null
  warnKm: number
  warnDays: number
  lastNotifiedAt: Date | null
  lastNotifiedStatus: 'soon' | 'overdue' | null
}

export type JobCategory =
  | 'service'
  | 'reparacion'
  | 'cubiertas'
  | 'frenos'
  | 'electricidad'
  | 'carroceria'
  | 'documentacion'
  | 'otros'

export const JOB_CATEGORY_LABELS: Record<JobCategory, string> = {
  service: 'Service',
  reparacion: 'Reparación',
  cubiertas: 'Cubiertas',
  frenos: 'Frenos',
  electricidad: 'Electricidad',
  carroceria: 'Carrocería',
  documentacion: 'Documentación',
  otros: 'Otros',
}

export interface Job {
  id: string
  carId: string
  date: ISODate
  km: number | null
  title: string
  category: JobCategory
  cost: number
  workshop: string | null
  notes: string | null
  ruleIds: string[]
  createdAt: Date
}

export interface FuelLoad {
  id: string
  carId: string
  date: ISODate
  km: number | null
  fuelType: FuelType
  /** Sólo para nafta; null en GNC o en cargas viejas sin el dato. */
  grade: NaftaGrade | null
  quantity: number
  unitPrice: number
  total: number
  fullTank: boolean
  station: string | null
  createdAt: Date
}

export type OdometerSource = 'initial' | 'manual' | 'job' | 'fuel'

export interface OdometerReading {
  id: string
  carId: string
  km: number
  date: Date
  source: OdometerSource
}

export interface UserSettings {
  reminder: { enabled: boolean; weekday: number }
  timezone: string
}

export const DEFAULT_SETTINGS: UserSettings = {
  reminder: { enabled: true, weekday: 0 },
  timezone: 'America/Argentina/Buenos_Aires',
}

export interface RulePreset {
  name: string
  intervalKm: number | null
  intervalTime: TimeInterval | null
  repeat: boolean
  /** Sólo se ofrece si el auto usa este combustible. */
  requires?: FuelType
}

const years = (amount: number): TimeInterval => ({ amount, unit: 'year' })

export const RULE_PRESETS: RulePreset[] = [
  { name: 'Service', intervalKm: 5000, intervalTime: years(1), repeat: true },
  { name: 'Correa de distribución', intervalKm: 60000, intervalTime: years(4), repeat: true },
  { name: 'Rotación de cubiertas', intervalKm: 10000, intervalTime: null, repeat: true },
  { name: 'Líquido de frenos', intervalKm: null, intervalTime: years(2), repeat: true },
  { name: 'VTV', intervalKm: null, intervalTime: years(1), repeat: true },
  { name: 'Seguro', intervalKm: null, intervalTime: years(1), repeat: true },
  { name: 'Prueba hidráulica GNC', intervalKm: null, intervalTime: years(5), repeat: true, requires: 'gnc' },
  { name: 'Oblea GNC', intervalKm: null, intervalTime: years(1), repeat: true, requires: 'gnc' },
  { name: 'Volver al taller', intervalKm: null, intervalTime: { amount: 1, unit: 'month' }, repeat: false },
]

/** Opciones rápidas de tiempo para no tener que escribir números. */
export const INTERVAL_PRESETS: Record<'repeat' | 'once', TimeInterval[]> = {
  repeat: [
    { amount: 1, unit: 'month' },
    { amount: 3, unit: 'month' },
    { amount: 6, unit: 'month' },
    { amount: 1, unit: 'year' },
    { amount: 2, unit: 'year' },
  ],
  once: [
    { amount: 1, unit: 'week' },
    { amount: 2, unit: 'week' },
    { amount: 3, unit: 'week' },
    { amount: 1, unit: 'month' },
    { amount: 3, unit: 'month' },
    { amount: 6, unit: 'month' },
  ],
}
