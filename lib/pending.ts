import { addDays, toISODate, weekdayOf } from './dates'
import { WEEKDAYS } from './format'
import { isCompleted, type RuleState, type RuleWithState } from './maintenance'
import { authorOf, canWrite, isCarOwner, isInviteOpen } from './sharing'
import type { Car, ISODate, Invite, Job, MaintenanceRule, UserSettings } from './types'

/**
 * Algo que el usuario tiene que hacer: cargar los km de un auto, atender un mantenimiento, revisar el trabajo
 * que cargó un miembro en su auto (`review`), corregir un trabajo suyo que el dueño rechazó (`rejected`) o
 * responder una invitación a compartir un auto (`invite`).
 */
export type PendingItem =
  | { kind: 'km'; car: Car; since: ISODate }
  | { kind: 'rule'; car: Car; rule: MaintenanceRule; state: RuleState }
  | { kind: 'review'; car: Car; job: Job }
  | { kind: 'rejected'; car: Car; job: Job }
  | { kind: 'invite'; invite: Invite }

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
 * Lo pendiente de todos los autos, lo más urgente primero: mantenimientos vencidos, trabajos para revisar (de
 * los miembros, en mis autos), km que faltan cargar, mis trabajos rechazados (en autos de otros), las invitaciones
 * que me mandaron (`invites`: sólo las pendientes que no vencieron a `now`) y mantenimientos por vencer. Los
 * recordatorios cumplidos no cuentan (`rulesByCar` ya viene sin ellos; se filtran igual). A un miembro `viewer` no se
 * le piden los km (`canWrite`): no los puede cargar.
 */
export function pendingItems(input: {
  settings: UserSettings
  cars: Car[]
  rulesByCar: Map<string, RuleWithState[]>
  jobs: Job[]
  uid: string
  invites: Invite[]
  now: Date
  today: ISODate
}): PendingItem[] {
  const { settings, cars, rulesByCar, jobs, uid, invites, now, today } = input
  const carById = new Map(cars.map(c => [c.id, c]))
  const rules = cars.flatMap(car =>
    (rulesByCar.get(car.id) ?? []).filter(r => !isCompleted(r.rule)).map(r => ({ kind: 'rule' as const, car, ...r })),
  )
  const km = cars.flatMap(car => {
    if (!canWrite(car, uid)) return []
    const since = kmDueSince(settings, car, today)
    return since ? [{ kind: 'km' as const, car, since }] : []
  })
  const review: PendingItem[] = []
  const rejected: PendingItem[] = []
  for (const job of jobs) {
    const car = carById.get(job.carId)
    if (!car) continue
    if (job.status === 'pending' && isCarOwner(car, uid)) review.push({ kind: 'review', car, job })
    if (job.status === 'rejected' && !isCarOwner(car, uid) && authorOf(job, car) === uid) {
      rejected.push({ kind: 'rejected', car, job })
    }
  }
  const invited = invites.filter(invite => isInviteOpen(invite, now)).map(invite => ({ kind: 'invite' as const, invite }))
  return [
    ...rules.filter(r => r.state.status === 'overdue'),
    ...review,
    ...km,
    ...rejected,
    ...invited,
    ...rules.filter(r => r.state.status === 'soon'),
  ]
}

/**
 * Cuántos pendientes cuenta el número de la campanita: todo menos los mantenimientos por vencer, que no
 * suman porque casi siempre hay alguno y el número quedaría prendido siempre.
 */
export function urgentCount(items: PendingItem[]) {
  return items.filter(i => i.kind !== 'rule' || i.state.status === 'overdue').length
}
