import { addDays, addInterval, daysBetween, intervalDays } from './dates'
import { formatDate, formatInterval, formatKm } from './format'
import { kmAtDate, linkedReadingId } from './odometer'
import { isApproved } from './sharing'
import type { Car, ISODate, Job, MaintenanceRule, TimeInterval } from './types'

export type RuleStatus = 'ok' | 'soon' | 'overdue' | 'unknown'

export interface RuleState {
  status: RuleStatus
  nextKm: number | null
  nextDate: ISODate | null
  remainingKm: number | null
  remainingDays: number | null
  /** Qué límite llega primero. */
  dueBy: 'km' | 'date' | null
  /** Fecha estimada en que se llega a nextKm según el uso promedio. */
  estimatedKmDate: ISODate | null
  /** Días hasta el primer vencimiento (por fecha o por km estimado); negativo si ya venció por fecha. */
  daysUntilDue: number | null
  /** Porcentaje del intervalo consumido (0-100, puede pasar 100 si está vencido). */
  progress: number
}

type RuleInput = Pick<
  MaintenanceRule,
  'intervalKm' | 'intervalTime' | 'lastDoneKm' | 'lastDoneDate' | 'warnKm' | 'warnDays'
>
type CarInput = Pick<Car, 'currentKm' | 'avgKmPerDay'>

export function getRuleState(rule: RuleInput, car: CarInput, today: ISODate): RuleState {
  const hasKm = rule.intervalKm != null && rule.intervalKm > 0 && rule.lastDoneKm != null
  const hasDate = rule.intervalTime != null && rule.intervalTime.amount > 0 && rule.lastDoneDate != null

  const nextKm = hasKm ? rule.lastDoneKm! + rule.intervalKm! : null
  const nextDate = hasDate ? addInterval(rule.lastDoneDate!, rule.intervalTime!) : null
  const remainingKm = nextKm != null ? nextKm - car.currentKm : null
  const remainingDays = nextDate != null ? daysBetween(today, nextDate) : null

  const avg = car.avgKmPerDay != null && car.avgKmPerDay > 0 ? car.avgKmPerDay : null
  const daysUntilKm = remainingKm != null && avg != null ? Math.max(0, remainingKm) / avg : null
  const estimatedKmDate = daysUntilKm != null ? addDays(today, Math.ceil(daysUntilKm)) : null

  const kmFraction = hasKm ? (car.currentKm - rule.lastDoneKm!) / rule.intervalKm! : null
  const dateFraction = hasDate
    ? daysBetween(rule.lastDoneDate!, today) / Math.max(1, daysBetween(rule.lastDoneDate!, nextDate!))
    : null
  const progress = Math.max(0, Math.round(100 * Math.max(kmFraction ?? 0, dateFraction ?? 0)))

  let dueBy: RuleState['dueBy'] = null
  if (hasKm && !hasDate) dueBy = 'km'
  else if (hasDate && !hasKm) dueBy = 'date'
  else if (hasKm && hasDate) {
    if (daysUntilKm != null) dueBy = daysUntilKm < remainingDays! ? 'km' : 'date'
    else dueBy = (kmFraction ?? 0) >= (dateFraction ?? 0) ? 'km' : 'date'
  }

  let status: RuleStatus
  if (!hasKm && !hasDate) status = 'unknown'
  else if ((remainingKm != null && remainingKm <= 0) || (remainingDays != null && remainingDays < 0)) status = 'overdue'
  else if (
    (remainingKm != null && remainingKm <= rule.warnKm) ||
    (remainingDays != null && remainingDays <= rule.warnDays) ||
    (daysUntilKm != null && daysUntilKm <= rule.warnDays)
  )
    status = 'soon'
  else status = 'ok'

  const dueCandidates = [remainingDays, daysUntilKm != null ? Math.ceil(daysUntilKm) : null].filter(
    (n): n is number => n != null,
  )
  const daysUntilDue = dueCandidates.length ? Math.min(...dueCandidates) : null

  return { status, nextKm, nextDate, remainingKm, remainingDays, dueBy, estimatedKmDate, daysUntilDue, progress }
}

const STATUS_WEIGHT: Record<RuleStatus, number> = { overdue: 0, soon: 1, ok: 2, unknown: 3 }

export function compareRuleStates(a: RuleState, b: RuleState): number {
  const w = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status]
  if (w !== 0) return w
  const da = a.daysUntilDue ?? Number.MAX_SAFE_INTEGER
  const db = b.daysUntilDue ?? Number.MAX_SAFE_INTEGER
  if (da !== db) return da - db
  return b.progress - a.progress
}

export interface RuleWithState {
  rule: MaintenanceRule
  state: RuleState
}

export function rulesWithState(rules: MaintenanceRule[], car: CarInput, today: ISODate): RuleWithState[] {
  return rules
    .map(rule => ({ rule, state: getRuleState(rule, car, today) }))
    .sort((a, b) => compareRuleStates(a.state, b.state))
}

/**
 * Texto corto de lo que falta: "faltan 420 km", "llegó al km" (justo en el km), "pasado 300 km", "vence en 12 días".
 * El 0 tiene su texto porque `Intl` formatea `-0` como "-0".
 */
export function describeRemaining(state: RuleState): { km: string | null; date: string | null } {
  const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
  let km: string | null = null
  if (state.remainingKm != null) {
    const r = state.remainingKm
    km = r > 0 ? `faltan ${fmt(r)} km` : r === 0 ? 'llegó al km' : `pasado ${fmt(-r)} km`
  }
  let date: string | null = null
  if (state.remainingDays != null) {
    const d = state.remainingDays
    if (d > 0) date = d === 1 ? 'vence mañana' : d < 60 ? `vence en ${d} días` : `vence en ${Math.round(d / 30)} meses`
    else if (d === 0) date = 'vence hoy'
    else date = -d === 1 ? 'venció ayer' : `venció hace ${-d} días`
  }
  return { km, date }
}

/** Una línea para avisos: "Service: faltan 400 km", "VTV: vence en 12 días", "Service: vencido (pasado 200 km)". */
export function summarizeRule(name: string, state: RuleState): string {
  const r = describeRemaining(state)
  const main = state.dueBy === 'date' ? (r.date ?? r.km) : (r.km ?? r.date)
  if (!main) return name
  return state.status === 'overdue' ? `${name}: vencido (${main})` : `${name}: ${main}`
}

/** "Cada 5.000 km o 1 año" / "Una sola vez, dentro de 3 semanas". */
export function describeRuleInterval(rule: Pick<MaintenanceRule, 'intervalKm' | 'intervalTime' | 'repeat'>): string {
  const parts = [rule.intervalKm ? formatKm(rule.intervalKm) : null, rule.intervalTime ? formatInterval(rule.intervalTime) : null]
    .filter(Boolean)
    .join(' o ')
  if (!parts) return rule.repeat ? 'Sin intervalo' : 'Una sola vez'
  return rule.repeat ? `Cada ${parts}` : `Una sola vez, dentro de ${parts}`
}

/**
 * Márgenes de aviso por defecto, proporcionales al intervalo: un recordatorio de 3 semanas
 * no puede avisar 30 días antes. Tope: 500 km y 30 días.
 */
export function defaultWarnings(intervalKm: number | null, intervalTime: TimeInterval | null) {
  return {
    warnKm: intervalKm ? Math.max(50, Math.min(500, Math.round(intervalKm / 5 / 50) * 50)) : 500,
    warnDays: intervalTime ? Math.max(2, Math.min(30, Math.round(intervalDays(intervalTime) / 4))) : 30,
  }
}

/** "48.300 km", o "≈ 48.300 km (estimado)" si el km de la última vez salió de las lecturas (`lastDoneKmEstimated`). */
export function formatLastDoneKm(rule: Pick<MaintenanceRule, 'lastDoneKm' | 'lastDoneKmEstimated'>): string | null {
  if (rule.lastDoneKm == null) return null
  return rule.lastDoneKmEstimated ? `≈ ${formatKm(rule.lastDoneKm)} (estimado)` : formatKm(rule.lastDoneKm)
}

/**
 * Un mantenimiento por km al que le falta el km de la última vez (lo deja así un trabajo sin km anterior a la
 * primera lectura, o una base sin km): sólo se calcula por fecha, y la UI lo pide con `MISSING_LAST_KM`.
 */
export const missingLastKm = (rule: Pick<MaintenanceRule, 'intervalKm' | 'lastDoneKm'>) =>
  rule.intervalKm != null && rule.intervalKm > 0 && rule.lastDoneKm == null

/** Lo que dice la UI de un mantenimiento por km sin el km de la última vez (`missingLastKm`). */
export const MISSING_LAST_KM = 'Falta el km de la última vez'

/**
 * Los mantenimientos marcados en un trabajo que reinician su km: los periódicos con intervalo de km. Para ellos el
 * trabajo necesita un km, el suyo o uno estimado (`jobDoneKm`).
 */
export function kmRulesOf<T extends Pick<MaintenanceRule, 'id' | 'intervalKm' | 'repeat'>>(
  rules: readonly T[],
  ruleIds: readonly string[],
): T[] {
  return rules.filter(r => ruleIds.includes(r.id) && r.repeat && r.intervalKm != null)
}

/**
 * El km con que un trabajo da por hechos sus mantenimientos: el suyo o, si no tiene, el estimado a su fecha con las
 * lecturas del auto (`kmAtDate`, `estimated: true`). No cuenta la lectura del propio trabajo (`job-{id}`; `id` falta
 * en uno nuevo), que se borra en el mismo batch si se le sacó el km. Nunca el km actual del auto: un trabajo viejo
 * cargado (o aprobado) hoy correría el próximo vencimiento. null si no tiene km y la fecha es anterior a la primera
 * lectura.
 */
export function jobDoneKm(
  job: { id?: string | null; carId: string; date: ISODate; km: number | null },
  readings: readonly { id: string; carId: string; km: number; date: Date }[],
): { km: number; estimated: boolean } | null {
  if (job.km != null) return { km: job.km, estimated: false }
  const own = job.id ? linkedReadingId('job', job.id) : null
  const estimate = kmAtDate(readings.filter(r => r.carId === job.carId && r.id !== own), job.date)
  return estimate ? { km: estimate.km, estimated: true } : null
}

/**
 * Lo que un mantenimiento toma de los trabajos aprobados y de su base. Se guarda en el documento como caché para el
 * cron. Es `type` y no `interface` (igual que `NotifyReset`) para que el patch entre en `batch.update`, que pide un
 * tipo con índice.
 */
export type RuleProjection = {
  lastDoneKm: number | null
  lastDoneDate: ISODate | null
  lastDoneKmEstimated: boolean
  lastDoneJobId: string | null
  completedByJobId: string | null
}

/** Lo que se escribe para que el cron vuelva a avisar con los datos nuevos, como al reiniciar un mantenimiento. */
export type NotifyReset = {
  lastNotifiedAt: null
  lastNotifiedStatus: null
}

/** El cambio a escribir en un mantenimiento: la proyección nueva y, si cambió lo que importa para avisar, `NotifyReset`. */
export type ProjectionPatch = RuleProjection & Partial<NotifyReset>

/** Un mantenimiento cuya proyección hay que guardar: `ruleId`, su auto y el cambio. */
export interface ProjectionChange {
  ruleId: string
  carId: string
  patch: ProjectionPatch
}

/** Lo que `projectRule` usa de un mantenimiento: lo declarado. */
export type ProjectableRule = Pick<MaintenanceRule, 'id' | 'carId' | 'intervalKm' | 'repeat' | 'baseKm' | 'baseDate'>

/** Un mantenimiento con la proyección que tiene guardada (o la que tiene la app en memoria). */
export type StoredRule = ProjectableRule & RuleProjection

/** Lo que `projectRule` usa de un trabajo. */
export type ProjectionJob = Pick<Job, 'id' | 'carId' | 'date' | 'km' | 'ruleIds' | 'status' | 'createdAt'>

/** Una lectura de km, con lo que usa `jobDoneKm`. */
type KmReading = { id: string; carId: string; km: number; date: Date }

const PROJECTION_KEYS: (keyof RuleProjection)[] = [
  'lastDoneKm',
  'lastDoneDate',
  'lastDoneKmEstimated',
  'lastDoneJobId',
  'completedByJobId',
]

/**
 * Orden de los trabajos de un mantenimiento: por fecha; si empatan, por `createdAt`, y si siguen empatados, por id,
 * así dos dispositivos eligen siempre el mismo.
 */
function compareJobs(a: ProjectionJob, b: ProjectionJob) {
  return a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
}

/**
 * El trabajo que manda en un mantenimiento: el aprobado más reciente del auto que lo marca y no es anterior a su base
 * (uno de la misma fecha que la base le gana). null si no hay ninguno.
 */
export function rulingJob<J extends ProjectionJob>(rule: ProjectableRule, jobs: readonly J[]): J | null {
  let best: J | null = null
  for (const job of jobs) {
    if (job.carId !== rule.carId || !isApproved(job) || !job.ruleIds.includes(rule.id)) continue
    if (rule.baseDate && job.date < rule.baseDate) continue
    if (!best || compareJobs(job, best) > 0) best = job
  }
  return best
}

/**
 * Estado de un mantenimiento según su base y los trabajos aprobados que lo marcan: manda el más reciente (fecha y, si
 * empatan, `createdAt`) que no sea anterior a la base. Sin trabajos, la base. Un periódico toma la fecha del trabajo
 * y, si tiene intervalo de km, el km del trabajo o, si no tiene, el estimado a su fecha (`jobDoneKm`, sin la lectura
 * del propio trabajo); sin intervalo de km, el km no importa y queda null. Un recordatorio de una vez queda cumplido
 * por ese trabajo (`completedByJobId`) y conserva su base.
 */
export function projectRule(rule: ProjectableRule, jobs: readonly ProjectionJob[], readings: readonly KmReading[]): RuleProjection {
  const fromBase: RuleProjection = {
    lastDoneKm: rule.baseKm,
    lastDoneDate: rule.baseDate,
    lastDoneKmEstimated: false,
    lastDoneJobId: null,
    completedByJobId: null,
  }
  const job = rulingJob(rule, jobs)
  if (!job) return fromBase
  if (!rule.repeat) return { ...fromBase, completedByJobId: job.id }
  const done = rule.intervalKm != null ? jobDoneKm(job, readings) : null
  return {
    lastDoneKm: done?.km ?? null,
    lastDoneDate: job.date,
    lastDoneKmEstimated: done?.estimated ?? false,
    lastDoneJobId: job.id,
    completedByJobId: null,
  }
}

/** Los mantenimientos con la proyección calculada en memoria, sin esperar a que se guarde. */
export function projectRules<T extends ProjectableRule>(
  rules: readonly T[],
  jobs: readonly ProjectionJob[],
  readings: readonly KmReading[],
): (T & RuleProjection)[] {
  return rules.map(rule => ({ ...rule, ...projectRule(rule, jobs, readings) }))
}

/** Un recordatorio de una vez cumplido por un trabajo: no cuenta como mantenimiento activo. */
export const isCompleted = (rule: Pick<MaintenanceRule, 'completedByJobId'>) => rule.completedByJobId != null

/** Los mantenimientos activos: sin los recordatorios cumplidos. */
export const activeRules = <T extends Pick<MaintenanceRule, 'completedByJobId'>>(rules: readonly T[]) =>
  rules.filter(r => !isCompleted(r))

/**
 * Lo que hay que escribir para pasar de la proyección guardada a `next`; null si ya coincide. Vuelve a avisar
 * (`NotifyReset`) si cambia la fecha, el cumplido o el km de un mantenimiento por km, salvo que el km sea estimado
 * antes y después: un estimado que se ajusta porque se cargó otra lectura no es un mantenimiento nuevo.
 */
export function projectionPatch(stored: StoredRule, next: RuleProjection): ProjectionPatch | null {
  if (PROJECTION_KEYS.every(k => stored[k] === next[k])) return null
  const kmMoved =
    stored.intervalKm != null &&
    stored.lastDoneKm !== next.lastDoneKm &&
    !(stored.lastDoneKmEstimated && next.lastDoneKmEstimated)
  const reset = kmMoved || stored.lastDoneDate !== next.lastDoneDate || stored.completedByJobId !== next.completedByJobId
  return reset ? { ...next, lastNotifiedAt: null, lastNotifiedStatus: null } : { ...next }
}

/** Los mantenimientos cuya proyección guardada no coincide con la calculada, con el cambio a escribir. */
export function projectionDiff(
  rules: readonly StoredRule[],
  jobs: readonly ProjectionJob[],
  readings: readonly KmReading[],
): ProjectionChange[] {
  const changes: ProjectionChange[] = []
  for (const rule of rules) {
    const patch = projectionPatch(rule, projectRule(rule, jobs, readings))
    if (patch) changes.push({ ruleId: rule.id, carId: rule.carId, patch })
  }
  return changes
}

/** Clave de un cambio de proyección, para no escribir dos veces el mismo (`DataProvider`). */
export const projectionKey = (change: ProjectionChange) => `${change.ruleId}:${JSON.stringify(change.patch)}`

/** La lista de trabajos con `id` reemplazado por `next`, o sin él si `next` es null. No modifica la recibida. */
function withJob<J extends { id: string }>(jobs: readonly J[], id: string, next: J | null): J[] {
  const rest = jobs.filter(j => j.id !== id)
  return next ? [...rest, next] : rest
}

/**
 * Lo que cambia en los mantenimientos cuando un trabajo pasa de `before` a `after` (null = no existe: crear o borrar).
 * Los afectados son los que marca antes o después y siguen en `rules`. Compara la proyección con el trabajo como
 * estaba contra la proyección con el trabajo como queda, así no depende de que `rules` esté al día: sirve también para
 * "Deshacer" con los datos de antes de borrar. `readingsAfter` son las lecturas después del cambio (con la del trabajo
 * puesta, cambiada o sacada); si falta, las mismas.
 */
export function jobChangeDiff(input: {
  rules: readonly ProjectableRule[]
  jobs: readonly ProjectionJob[]
  readings: readonly KmReading[]
  readingsAfter?: readonly KmReading[]
  before: ProjectionJob | null
  after: ProjectionJob | null
}): ProjectionChange[] {
  const { rules, jobs, readings, before, after } = input
  const job = after ?? before
  if (!job) return []
  const ids = new Set([...(before?.ruleIds ?? []), ...(after?.ruleIds ?? [])])
  const affected = rules.filter(r => r.carId === job.carId && ids.has(r.id))
  if (!affected.length) return []
  const was = projectRules(affected, withJob(jobs, job.id, before), readings)
  return projectionDiff(was, withJob(jobs, job.id, after), input.readingsAfter ?? readings)
}

/**
 * Cómo queda un mantenimiento después de un cambio, para las confirmaciones: "Service vuelve a 12 de mar de 2026 ·
 * 40.000 km", "Volver al taller queda cumplido", "Volver al taller vuelve a estar activo".
 */
export function describeProjectionChange(
  rule: Pick<MaintenanceRule, 'name' | 'repeat' | 'intervalKm' | 'lastDoneDate'>,
  next: RuleProjection,
): string {
  if (next.completedByJobId) return `${rule.name} queda cumplido`
  if (!rule.repeat) return `${rule.name} vuelve a estar activo`
  if (!next.lastDoneDate) return `${rule.name} queda sin la última vez`
  const verb = rule.lastDoneDate && next.lastDoneDate < rule.lastDoneDate ? 'vuelve a' : 'pasa a'
  const km = rule.intervalKm != null ? formatLastDoneKm(next) : null
  return `${rule.name} ${verb} ${[formatDate(next.lastDoneDate), km].filter(Boolean).join(' · ')}`
}

