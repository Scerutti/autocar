const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = v => (typeof v === 'string' && v.trim() ? v : null)

/** Un trabajo sin estado (guardado antes de compartir autos) cuenta como aprobado, como en lib/db.ts. */
const isApproved = job => job.data.status !== 'pending' && job.data.status !== 'rejected'

/** El mantenimiento ya tiene su base: los dos campos existen en el documento (aunque sean null). */
export const hasBase = data => 'baseKm' in data && 'baseDate' in data

/**
 * Decide la base (`baseKm`, `baseDate`) de los mantenimientos de un auto que todavía no la tienen, a partir de lo que
 * ya se leyó de Firestore. No toca Firestore: lo corre `rebase-rules.mjs` y lo prueba vitest.
 *
 * `car`, y cada elemento de `rules` y `jobs`, vienen como `{ id, data }`. A cada mantenimiento al que le falta
 * `baseKm` o `baseDate` le escribe los dos:
 * - Si su `lastDoneDate` es la fecha de un trabajo aprobado del auto que lo tiene en `ruleIds`, `baseKm: null` y
 *   `baseDate: null`: esa "última vez" la puso el trabajo, y si después se borra o se corrige el trabajo, el
 *   mantenimiento tiene que volver atrás y no quedarse con la fecha del trabajo.
 * - Si no, `baseKm = lastDoneKm` y `baseDate = lastDoneDate`: la cargó el dueño a mano.
 * No escribe la proyección (`lastDoneJobId`, `completedByJobId`): la calcula y la guarda la reconciliación de la app
 * (`projectRule`, `DataProvider`) la primera vez que el dueño la abre, y hasta entonces el cron sigue con los
 * `lastDone*` que ya están guardados, que no cambian.
 *
 * Devuelve `writes` (`{ path, data }`, para un `update`) y el `report` del auto: cuántos quedaron con base propia
 * (`own`), cuántos con base null (`fromJob`) y cuántos ya tenían base (`skipped`). Si ya se corrió, no devuelve nada
 * para escribir.
 */
export function planCarRebase({ car, rules, jobs }) {
  const carId = car.id
  const writes = []
  const report = { carId, own: 0, fromJob: 0, skipped: 0 }
  const approved = jobs.filter(isApproved)
  for (const rule of rules) {
    if (hasBase(rule.data)) {
      report.skipped++
      continue
    }
    const lastDoneDate = str(rule.data.lastDoneDate)
    const explained =
      lastDoneDate != null &&
      approved.some(j => j.data.date === lastDoneDate && Array.isArray(j.data.ruleIds) && j.data.ruleIds.includes(rule.id))
    const data = explained ? { baseKm: null, baseDate: null } : { baseKm: num(rule.data.lastDoneKm), baseDate: lastDoneDate }
    writes.push({ path: `cars/${carId}/rules/${rule.id}`, data })
    if (explained) report.fromJob++
    else report.own++
  }
  return { writes, report }
}

/** Parte las escrituras en tandas de como mucho `size`: un batch de Firestore admite hasta 500. */
export function chunk(items, size = 450) {
  const batches = []
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size))
  return batches
}
