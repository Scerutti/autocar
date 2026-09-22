import { addDays, addInterval, daysBetween, intervalDays } from './dates'
import { formatInterval, formatKm } from './format'
import type { Car, ISODate, MaintenanceRule, TimeInterval } from './types'

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

/** Texto corto de lo que falta: "faltan 420 km", "vence en 12 días", "vencido hace 300 km". */
export function describeRemaining(state: RuleState): { km: string | null; date: string | null } {
  const fmt = (n: number) => new Intl.NumberFormat('es-AR').format(n)
  let km: string | null = null
  if (state.remainingKm != null) {
    km = state.remainingKm > 0 ? `faltan ${fmt(state.remainingKm)} km` : `pasado ${fmt(-state.remainingKm)} km`
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
