import { weekdayOf } from './dates'
import { describeRemaining, getRuleState } from './maintenance'
import type { Car, ISODate, MaintenanceRule, UserSettings } from './types'

export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}

export interface RuleNotificationUpdate {
  ruleId: string
  lastNotifiedStatus: 'soon' | 'overdue' | null
  notified: boolean
}

const RENOTIFY_DAYS = 7

const nameOf = (car: Pick<Car, 'brand' | 'model'>) => `${car.brand} ${car.model}`.trim()

/**
 * Decide qué avisos mandar hoy a un usuario. Es pura para poder testearla;
 * el cron se encarga de leer Firestore, enviar y persistir las actualizaciones.
 */
export function planDailyNotifications(input: {
  settings: UserSettings
  cars: Car[]
  rules: MaintenanceRule[]
  today: ISODate
  now: Date
}): { messages: PushPayload[]; ruleUpdates: RuleNotificationUpdate[] } {
  const { settings, cars, rules, today, now } = input
  const messages: PushPayload[] = []
  const ruleUpdates: RuleNotificationUpdate[] = []

  if (settings.reminder.enabled && weekdayOf(today) === settings.reminder.weekday) {
    for (const car of cars) {
      messages.push({
        title: `¿Cuántos km tiene tu ${nameOf(car)}?`,
        body: `Tocá para cargarlos. Último registro: ${car.currentKm.toLocaleString('es-AR')} km.`,
        url: `/autos/${car.id}/km`,
        tag: `km-${car.id}`,
      })
    }
  }

  const carById = new Map(cars.map(c => [c.id, c]))
  for (const rule of rules) {
    const car = carById.get(rule.carId)
    if (!car) continue
    const state = getRuleState(rule, car, today)

    if (state.status !== 'soon' && state.status !== 'overdue') {
      // Volvió a estar al día (se hizo el mantenimiento): limpiar para que avise en el próximo ciclo.
      if (rule.lastNotifiedStatus) ruleUpdates.push({ ruleId: rule.id, lastNotifiedStatus: null, notified: false })
      continue
    }

    const escalated = rule.lastNotifiedStatus !== state.status
    const stale = !rule.lastNotifiedAt || now.getTime() - rule.lastNotifiedAt.getTime() >= RENOTIFY_DAYS * 86_400_000 - 3_600_000
    if (!escalated && !stale) continue

    const r = describeRemaining(state)
    const detail = [r.km, r.date].filter(Boolean).join(' · ')
    messages.push({
      title: `${state.status === 'overdue' ? 'Vencido' : 'Se acerca'}: ${rule.name}`,
      body: `${nameOf(car)} — ${detail}`,
      url: `/autos/${car.id}/mantenimientos/${rule.id}`,
      tag: `rule-${rule.id}`,
    })
    ruleUpdates.push({ ruleId: rule.id, lastNotifiedStatus: state.status, notified: true })
  }

  return { messages, ruleUpdates }
}
