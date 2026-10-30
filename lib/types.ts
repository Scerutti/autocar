/**
 * Fechas "de calendario" (sin hora) se guardan como 'YYYY-MM-DD'.
 * Instantes (cuándo se cargó algo) se manejan como Date y en Firestore como Timestamp.
 */
export type ISODate = string

/**
 * Un auto anda a nafta, a nafta + GNC o a gasoil (no hay autos sólo a GNC, y el equipo de GNC es para
 * motores nafteros). La nafta y el gasoil pueden ser súper o premium.
 */
export type FuelType = 'nafta' | 'gasoil' | 'gnc'
export type FuelGrade = 'super' | 'premium'

export const FUEL_LABELS: Record<FuelType, string> = { nafta: 'Nafta', gasoil: 'Gasoil', gnc: 'GNC' }
export const FUEL_UNITS: Record<FuelType, string> = { nafta: 'L', gasoil: 'L', gnc: 'm³' }
export const FUEL_GRADE_LABELS: Record<FuelGrade, string> = { super: 'Súper', premium: 'Premium' }

/** Nafta y gasoil: se cargan en litros, vienen en súper o premium y se puede llenar el tanque. */
export const isLiquidFuel = (t: FuelType) => t !== 'gnc'

export type IntervalUnit = 'day' | 'week' | 'month' | 'year'

/** Un lapso de tiempo: "3 semanas", "6 meses", "1 año". */
export interface TimeInterval {
  amount: number
  unit: IntervalUnit
}

/** Quién escribe un dato: el uid de la cuenta y el nombre de Google (null si no lo tiene). */
export interface Actor {
  uid: string
  name: string | null
}

/** Autoría de un registro de un auto. Opcional en el tipo porque los registros viejos no la tienen. */
export interface Authorship {
  /** Uid de quien lo cargó; se graba al crear y no cambia al editar. */
  createdBy?: string | null
  createdByName?: string | null
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
  /** Uid del dueño. Opcional en el tipo porque el cron y los logros arman autos sin él; lib/db.ts siempre lo completa. */
  ownerUid?: string
  ownerName?: string | null
  /**
   * Mails en minúscula de las personas con las que el dueño compartió el auto antes de las invitaciones (hasta 2). El
   * dueño no figura. Sólo se leen y se sacan: se borra en #66.
   */
  members?: string[]
  /** Uids de las personas que aceptaron una invitación al auto (hasta 2). El dueño no figura. */
  memberUids?: string[]
  /** Mail y nombre de cada miembro, por uid: para mostrarlos. Tiene las mismas claves que `memberUids`. */
  memberProfiles?: Record<string, MemberProfile>
}

/** Cómo se muestra un miembro: el mail con el que entró y su nombre de Google (null si no lo tiene). */
export interface MemberProfile {
  email: string
  name: string | null
}

export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'revoked'

/**
 * Invitación a compartir un auto (invites/{carId}_{emailKey}): una activa por auto y mail. El auto le aparece al
 * invitado recién cuando la acepta.
 */
export interface Invite {
  id: string
  carId: string
  ownerUid: string
  ownerName: string | null
  /** "Ford Ka 2015": lo que el invitado ve antes de aceptar, sin poder leer el auto. */
  carLabel: string
  /** Como lo escribió el dueño, en minúscula. */
  email: string
  /** canonicalEmail(email): con lo que se compara contra el login. */
  emailKey: string
  status: InviteStatus
  createdAt: Date
  /** Pasada esta fecha no se puede aceptar ni rechazar: el dueño la puede volver a mandar. */
  expiresAt: Date
  respondedAt: Date | null
  /** Uid de la cuenta que respondió la invitación; null mientras está pendiente o si el dueño la canceló. */
  acceptedUid: string | null
}

/**
 * Un mantenimiento. Separa lo que declara el dueño (la "última vez" cargada a mano: `baseKm`, `baseDate`) de lo que
 * sale de los trabajos aprobados (la proyección: `lastDone*`, `lastDoneJobId`, `completedByJobId`). La proyección se
 * calcula con `projectRule` (lib/maintenance.ts) y se guarda sólo como caché para el cron: la escriben lib/db.ts y
 * la reconciliación de `DataProvider`, nunca el formulario.
 */
export interface MaintenanceRule {
  id: string
  carId: string
  name: string
  intervalKm: number | null
  /** Cada cuánto tiempo; si no se repite, dentro de cuánto. */
  intervalTime: TimeInterval | null
  /**
   * false = recordatorio de una sola vez (p. ej. "volver al taller en 3 semanas"): cuando un trabajo lo marca, queda
   * cumplido (`completedByJobId`) en vez de reiniciarse.
   */
  repeat: boolean
  /** Km de la "última vez" que cargó el dueño (si no hay trabajos que lo marquen). null = sin dato. */
  baseKm: number | null
  /** Fecha de la "última vez" que cargó el dueño; en uno de una sola vez, desde cuándo se cuenta. null = sin dato. */
  baseDate: ISODate | null
  /** Km de la última vez según la proyección: el del trabajo que manda o el de la base. */
  lastDoneKm: number | null
  /**
   * true si `lastDoneKm` no es un dato sino una estimación con las lecturas de km (`kmAtDate`): lo dejó un trabajo
   * sin km. Se muestra como "≈ 48.300 km (estimado)". false en los viejos sin el campo.
   */
  lastDoneKmEstimated: boolean
  /** Fecha de la última vez según la proyección: la del trabajo que manda o la de la base. */
  lastDoneDate: ISODate | null
  /** El trabajo aprobado que explica `lastDone*` ("Según el trabajo «Service» del 12/03"); null si manda la base. */
  lastDoneJobId: string | null
  /** Sólo en los de una sola vez: el trabajo aprobado que lo cumplió. Si no es null, el recordatorio está cumplido. */
  completedByJobId: string | null
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

export type JobStatus = 'approved' | 'pending' | 'rejected'

export interface Job extends Authorship {
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
  /** Un trabajo sin el campo (guardado antes de compartir autos) cuenta como aprobado. */
  status?: JobStatus
  /** Cuándo el dueño aprobó o rechazó el trabajo de un miembro; null si nadie lo revisó. */
  reviewedAt?: Date | null
  /**
   * Versión del trabajo: arranca en 0 y sube en 1 cada vez que se edita uno que no está aprobado (`jobEdit`). El dueño
   * aprueba o rechaza con la que vio y las reglas de Firestore lo deniegan si ya no es la guardada: así no aprueba una
   * versión vieja. Un trabajo sin el campo (guardado por la versión 1.4.1 de la PWA o anterior) cuenta como 0.
   */
  revision: number
  createdAt: Date
}

export interface FuelLoad extends Authorship {
  id: string
  carId: string
  date: ISODate
  km: number | null
  fuelType: FuelType
  /** Sólo para nafta y gasoil; null en GNC o en cargas viejas sin el dato. */
  grade: FuelGrade | null
  quantity: number
  unitPrice: number
  total: number
  fullTank: boolean
  station: string | null
  createdAt: Date
}

export type OdometerSource = 'initial' | 'manual' | 'job' | 'fuel'

export interface OdometerReading extends Authorship {
  id: string
  carId: string
  km: number
  date: Date
  source: OdometerSource
  /**
   * Id de la carga o del trabajo del que salió la lectura (`source` 'fuel' o 'job'); el id de la lectura es
   * `{source}-{sourceId}`. null en las de alta, las manuales y las viejas sin vincular.
   */
  sourceId: string | null
  /**
   * Cuándo se cargó la lectura en la app (para los logros: la fecha de una lectura manual puede ser de hace semanas).
   * null en las viejas sin el dato.
   */
  createdAt: Date | null
}

/**
 * Un logro conseguido (users/{uid}/achievements/{id del logro}). Es permanente: no se borra aunque
 * después se editen o borren los registros que lo dieron.
 */
export interface AchievementRecord {
  id: string
  /** Auto con el que se consiguió (null si ya no se sabe). */
  carId: string | null
  unlockedAt: Date
  /** Cuándo el usuario vio o descartó la celebración; null = celebración pendiente. */
  celebratedAt: Date | null
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
