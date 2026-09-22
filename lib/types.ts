// Fechas "de calendario" (sin hora) se guardan como 'YYYY-MM-DD'.
// Instantes (cuándo se cargó algo) se manejan como Date y en Firestore como Timestamp.
export type ISODate = string

export type FuelType = 'nafta' | 'gnc'

export const FUEL_LABELS: Record<FuelType, string> = { nafta: 'Nafta', gnc: 'GNC' }
export const FUEL_UNITS: Record<FuelType, string> = { nafta: 'L', gnc: 'm³' }

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
  intervalMonths: number | null
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
  intervalMonths: number | null
}

export const RULE_PRESETS: RulePreset[] = [
  { name: 'Service', intervalKm: 5000, intervalMonths: 12 },
  { name: 'Correa de distribución', intervalKm: 60000, intervalMonths: 48 },
  { name: 'Rotación de cubiertas', intervalKm: 10000, intervalMonths: null },
  { name: 'Líquido de frenos', intervalKm: null, intervalMonths: 24 },
  { name: 'VTV', intervalKm: null, intervalMonths: 12 },
  { name: 'Seguro', intervalKm: null, intervalMonths: 12 },
  { name: 'Prueba hidráulica GNC', intervalKm: null, intervalMonths: 60 },
  { name: 'Oblea GNC', intervalKm: null, intervalMonths: 12 },
]
