import { addDays, toISODate, weekdayOf } from './dates'
import { WEEKDAYS } from './format'
import type { RuleState, RuleWithState } from './maintenance'
import type { Car, ISODate, MaintenanceRule, UserSettings } from './types'

/** Algo que el usuario tiene que hacer: cargar los km de un auto o atender un mantenimiento. */
export type PendingItem =
  | { kind: 'km'; car: Car; since: ISODate }
  | { kind: 'rule'; car: Car; rule: MaintenanceRule; state: RuleState }

/**
 * Desde cuándo se deben los km de un auto: el último día de recordatorio (hoy incluido) si el km no se
 * actualizó desde ese día. Sigue el mismo criterio que el pedido semanal del cron, así la campanita
 * muestra lo mismo que pidió el aviso aunque se haya descartado. null si no se deben o el recordatorio está
 * apagado.
 */
export function kmDueSince(settings: UserSettings, car: Pick<Car, 'kmUpdatedAt'>, today: ISODate): ISODate | null {
  if (!settings.reminder.enabled) return null
  const lastReminder = addDays(today, -((weekdayOf(today) - settings.reminder.weekday + 7) % 7))
  if (car.kmUpdatedAt && toISODate(car.kmUpdatedAt) >= lastReminder) return null
  return lastReminder
}

/** "hoy" o "el domingo": cuándo se pidieron los km. Siempre es un día de esta semana (el último recordatorio). */
export function kmDueDay(since: ISODate, today: ISODate) {
  return since === today ? 'hoy' : `el ${WEEKDAYS[weekdayOf(since)].toLowerCase()}`
}

/**
 * Lo pendiente de todos los autos, lo más urgente primero: mantenimientos vencidos, km que faltan cargar y
 * mantenimientos por vencer.
 */
export function pendingItems(input: {
  settings: UserSettings
  cars: Car[]
  rulesByCar: Map<string, RuleWithState[]>
  today: ISODate
}): PendingItem[] {
  const { settings, cars, rulesByCar, today } = input
  const rules = cars.flatMap(car => (rulesByCar.get(car.id) ?? []).map(r => ({ kind: 'rule' as const, car, ...r })))
  const km = cars.flatMap(car => {
    const since = kmDueSince(settings, car, today)
    return since ? [{ kind: 'km' as const, car, since }] : []
  })
  return [
    ...rules.filter(r => r.state.status === 'overdue'),
    ...km,
    ...rules.filter(r => r.state.status === 'soon'),
  ]
}

/**
 * Cuántos pendientes cuenta el número de la campanita: los vencidos y los km. Los por vencer no suman,
 * porque casi siempre hay alguno y el número quedaría prendido siempre.
 */
export function urgentCount(items: PendingItem[]) {
  return items.filter(i => i.kind === 'km' || i.state.status === 'overdue').length
}
