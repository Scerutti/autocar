'use client'

import { Timestamp } from 'firebase/firestore'
import { describeRemaining, projectRules } from './maintenance'
import { escalatedRules, type JobNotificationEvent } from './notifications'
import { carKmFrom, linkedReadingId, readingDateOf, withLinkedReading } from './odometer'
import { toast } from './toast'
import type { Car, ISODate, Job, MaintenanceRule, OdometerReading } from './types'

type GetToken = () => Promise<string | null>

async function postNotify(path: string, body: unknown, getToken: GetToken) {
  try {
    const token = await getToken()
    if (!token) return
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    return
  }
}

/**
 * Avisa en segundo plano al servidor cuando un miembro manda un trabajo (`submitted`) o el dueño lo aprueba o rechaza
 * (`approved` | `rejected`). Se engancha a la promesa de escritura, así también sale si se guardó sin señal y sincronizó
 * con la app abierta; si la app se cierra antes de recuperar señal, `submitted` queda cubierto por el resumen diario
 * del cron y `approved` / `rejected` se ven en la campanita y en el trabajo al abrir la app.
 */
export function notifyJobInBackground(
  input: { carId: string; jobId: string; event: JobNotificationEvent },
  getToken: GetToken,
) {
  void postNotify('/api/notify/job', input, getToken)
}

/**
 * Avisa en segundo plano al resto del grupo del auto (`POST /api/notify/rules`) los mantenimientos (`ruleIds`) que
 * subieron de estado con la carga recién confirmada.
 */
export function notifyRulesInBackground(carId: string, ruleIds: string[], getToken: GetToken) {
  if (!ruleIds.length) return
  void postNotify('/api/notify/rules', { carId, ruleIds }, getToken)
}

/**
 * Muestra a quien hizo la carga un toast por cada mantenimiento activo del auto que pasó a por vencer o vencido, y si
 * hubo alguno y el auto tiene miembros le pide al servidor que avise por push al resto del grupo.
 */
export function announceRuleEscalations(input: {
  car: Car
  carBefore: Pick<Car, 'currentKm' | 'avgKmPerDay'>
  carAfter: Pick<Car, 'currentKm' | 'avgKmPerDay'>
  rulesBefore: MaintenanceRule[]
  rulesAfter: MaintenanceRule[]
  today: ISODate
  getToken: GetToken
}) {
  const { car, carBefore, carAfter, rulesBefore, rulesAfter, today, getToken } = input
  const escalations = escalatedRules({ carBefore, carAfter, rulesBefore, rulesAfter, today })
  if (!escalations.length) return
  for (const { rule, state, status } of escalations) {
    const r = describeRemaining(state)
    const detail = [r.km, r.date].filter(Boolean).join(' · ')
    toast.warning(
      status === 'overdue' ? `Ojo: ${rule.name} quedó vencido` : `Ojo: ${rule.name} está por vencer`,
      detail ? { description: detail } : undefined,
    )
  }
  if ((car.memberUids?.length ?? 0) > 0) {
    notifyRulesInBackground(
      car.id,
      escalations.map(e => e.rule.id),
      getToken,
    )
  }
}

/**
 * Calcula cómo quedan el km del auto y la proyección de sus mantenimientos después de un cambio en las lecturas o en
 * los trabajos, y anuncia los mantenimientos que subieron de estado (`announceRuleEscalations`).
 */
export function checkCarRuleEscalations(input: {
  car: Car
  rawRules: MaintenanceRule[]
  jobsBefore: Job[]
  jobsAfter: Job[]
  readingsBefore: OdometerReading[]
  readingsAfter: OdometerReading[]
  today: ISODate
  getToken: GetToken
}) {
  const { car, rawRules, jobsBefore, jobsAfter, readingsBefore, readingsAfter, today, getToken } = input
  const carRules = rawRules.filter(r => r.carId === car.id)
  if (!carRules.length) return
  const carReadingsBefore = readingsBefore.filter(r => r.carId === car.id)
  const carReadingsAfter = readingsAfter.filter(r => r.carId === car.id)
  const kmBefore = carKmFrom(carReadingsBefore)
  const kmAfter = carKmFrom(carReadingsAfter)
  const carBefore = kmBefore
    ? { currentKm: kmBefore.currentKm, avgKmPerDay: kmBefore.avgKmPerDay }
    : { currentKm: car.currentKm, avgKmPerDay: car.avgKmPerDay }
  const carAfter = kmAfter
    ? { currentKm: kmAfter.currentKm, avgKmPerDay: kmAfter.avgKmPerDay }
    : { currentKm: car.currentKm, avgKmPerDay: car.avgKmPerDay }
  const rulesBefore = projectRules(carRules, jobsBefore, readingsBefore)
  const rulesAfter = projectRules(carRules, jobsAfter, readingsAfter)
  announceRuleEscalations({ car, carBefore, carAfter, rulesBefore, rulesAfter, today, getToken })
}

/** Las lecturas después de poner o sacar una lectura vinculada (`fuel-{id}` o `job-{id}`), en memoria. */
export function readingsWithLinked(
  readings: OdometerReading[],
  carId: string,
  source: 'fuel' | 'job',
  sourceId: string,
  entry: { date: ISODate; km: number | null } | null,
): OdometerReading[] {
  const id = linkedReadingId(source, sourceId)
  const next: OdometerReading | null =
    entry && entry.km != null
      ? {
          id,
          carId,
          km: entry.km,
          date: readingDateOf(entry.date),
          source,
          sourceId,
          createdAt: Timestamp.now().toDate(),
        }
      : null
  return [
    ...readings.filter(r => r.carId !== carId),
    ...withLinkedReading(
      readings.filter(r => r.carId === car.id),
      id,
      next,
    ),
  ]
}
