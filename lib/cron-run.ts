/** Tope de usuarios con error que se guardan en `cronRuns/{fecha}.failures`, sumando todas las corridas del día. */
export const MAX_FAILURES = 20

export type CronFailure = { uid: string; message: string }

export type CronUserReport = { uid: string; messages: number; sent: number; error?: string }

/** Lo que importa de `cronRuns/{fecha}` para decidir qué hace la corrida y para acumular las métricas del día. */
export type CronRunState = {
  finishedAt: Date | null
  processed: number
  skipped: number
  errors: number
  sent: number
  cursor: string | null
  failures: CronFailure[]
}

/** Las métricas que se guardan en `cronRuns/{fecha}` al terminar una corrida: acumuladas en el día salvo `candidates` y `skipped`. */
export type CronRunSummary = {
  candidates: number
  processed: number
  skipped: number
  errors: number
  sent: number
  cursor: string | null
  failures: CronFailure[]
}

/** El id del registro del día: la fecha UTC de la corrida (`YYYY-MM-DD`). */
export function runDateOf(now: Date) {
  return now.toISOString().slice(0, 10)
}

/**
 * Los uids con al menos una suscripción push, a partir de las rutas de `collectionGroup('pushSubscriptions')`.
 * Solo cuentan las de `users/{uid}/pushSubscriptions/{id}`. Sin repetir y ordenados, para que el cursor sirva entre
 * corridas.
 */
export function candidateUids(paths: string[]) {
  const uids = new Set<string>()
  for (const path of paths) {
    const [root, uid, sub, id, ...rest] = path.split('/')
    if (root === 'users' && uid && sub === 'pushSubscriptions' && id && !rest.length) uids.add(uid)
  }
  return [...uids].sort()
}

/** El día ya está hecho: una corrida terminó sin dejar usuarios afuera. */
export function runIsDone(previous: CronRunState | null) {
  return previous != null && previous.finishedAt != null && previous.skipped === 0
}

/**
 * A quiénes procesa esta corrida: los uids después del cursor de la anterior. Sin corrida previa, o con una que
 * terminó sin cursor, son todos. Si la anterior se cortó sin terminar (`finishedAt == null`), su cursor es el de la
 * última que sí terminó, así que se retoma desde ahí.
 */
export function queueFrom(uids: string[], previous: CronRunState | null) {
  const cursor = previous?.cursor ?? null
  return cursor == null ? uids : uids.filter(uid => uid > cursor)
}

/** Usuarios procesados, con error y mensajes enviados de una corrida. */
export function tally(reports: CronUserReport[]) {
  return {
    processed: reports.length,
    errors: reports.filter(r => r.error != null).length,
    sent: reports.reduce((n, r) => n + r.sent, 0),
  }
}

/**
 * Las métricas del día al terminar una corrida. Los workers toman los usuarios en orden y los que arrancaron terminan
 * antes de responder, así que los procesados son justo `queue[0..next)`: el cursor es el último de esos si quedó
 * alguien afuera, y null si no. Los usuarios con error no se reintentan: quedan antes del cursor y en `failures`.
 */
export function summarizeRun(input: {
  queue: string[]
  next: number
  reports: CronUserReport[]
  candidates: number
  previous: CronRunState | null
}): CronRunSummary {
  const { queue, next, reports, candidates, previous } = input
  const run = tally(reports)
  const skipped = queue.length - next
  const cursor = skipped > 0 ? (next > 0 ? queue[next - 1] : (previous?.cursor ?? null)) : null
  const failures = reports.filter(r => r.error != null).map(r => ({ uid: r.uid, message: r.error! }))
  return {
    candidates,
    processed: (previous?.processed ?? 0) + run.processed,
    skipped,
    errors: (previous?.errors ?? 0) + run.errors,
    sent: (previous?.sent ?? 0) + run.sent,
    cursor,
    failures: [...(previous?.failures ?? []), ...failures].slice(0, MAX_FAILURES),
  }
}

/**
 * Cuántos mantenimientos se leen de cada auto: el tope por usuario repartido en partes iguales (al menos uno), así
 * las lecturas en paralelo no se pasan del tope entre todos los autos.
 */
export function perCarLimit(carCount: number, maxDocs: number) {
  if (carCount <= 0) return 0
  return Math.max(1, Math.floor(maxDocs / carCount))
}
