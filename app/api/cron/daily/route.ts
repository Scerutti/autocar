import { createHash, timingSafeEqual } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
import { purgeCutoff } from '@/lib/cars'
import { purgeCar } from '@/lib/cars-server'
import { adminDb } from '@/lib/firebase/admin'
import {
  candidateUids,
  queueFrom,
  runDateOf,
  runIsBusy,
  runIsDone,
  summarizeRun,
  tally,
  type CronFailure,
  type CronRunState,
  type CronRunSummary,
  type CronUserReport,
} from '@/lib/cron-run'
import { todayInTimeZone } from '@/lib/dates'
import { orphanNoticeIds, planDailyNotifications, updatesToPersist } from '@/lib/notifications'
import { carKmForNotifications } from '@/lib/odometer'
import { MAX_DOCS_PER_USER, sendToUser, serverCarFrom, serverNoticeFrom, serverRuleFrom, serverSettingsFrom, topReadingOf } from '@/lib/push-server'
import { isSharedCar } from '@/lib/sharing'
import type { Car, RuleNotice } from '@/lib/types'

export const maxDuration = 60

/**
 * Pasado este tiempo no se empiezan usuarios nuevos: los que están en curso tienen margen para
 * terminar antes de maxDuration (cada uno tarda a lo sumo un timeout de push más las lecturas).
 */
const TIME_BUDGET_MS = 40_000

/** Usuarios que se procesan a la vez: lo lento es esperar a Firestore y a los servicios de push. */
const CONCURRENCY = 5

/**
 * Pasado este tiempo desde que arrancó la corrida, el barrido no empieza a borrar otro auto. Es menor que
 * `TIME_BUDGET_MS`: un auto con mucho historial tarda, y el que está en curso tiene que terminar antes de
 * `maxDuration`. Si se corta, `purgeCar` lo retoma en la próxima corrida.
 */
const SWEEP_BUDGET_MS = 30_000

/** Autos marcados que levanta el barrido por corrida, los marcados hace más tiempo primero. */
const SWEEP_LIMIT = 20

/**
 * Lo que hizo el barrido de autos borrados: cuántos encontró, cuántos terminó de borrar, cuántos quedaron con la foto
 * pendiente (Cloudinary falló; el auto marcado queda para la próxima corrida), cuántos dieron error, y el error de la
 * consulta si no pudo arrancar.
 */
type SweepReport = { found: number; purged: number; photoPending: number; errors: number; error?: string }

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** El registro del día (`cronRuns/{fecha}`) como lo usa `lib/cron-run.ts`. Lo que falta cuenta como cero o vacío. */
function runStateFrom(x: DocumentData): CronRunState {
  return {
    runningSince: toDate(x.runningSince),
    finishedAt: toDate(x.finishedAt),
    processed: num(x.processed) ?? 0,
    skipped: num(x.skipped) ?? 0,
    errors: num(x.errors) ?? 0,
    sent: num(x.sent) ?? 0,
    cursor: typeof x.cursor === 'string' ? x.cursor : null,
    failures: Array.isArray(x.failures) ? (x.failures as CronFailure[]) : [],
  }
}

/**
 * Los mantenimientos de todos los autos a la vez, con tope `MAX_DOCS_PER_USER` por auto y sobre el total, así un auto
 * con muchos mantenimientos aprovecha el cupo libre de los demás.
 */
async function rulesOf(carDocs: QueryDocumentSnapshot[]) {
  const snaps = await Promise.all(carDocs.map(carDoc => carDoc.ref.collection('rules').limit(MAX_DOCS_PER_USER).get()))
  return snaps
    .flatMap(snap => snap.docs.map(d => serverRuleFrom(d.id, d.data())))
    .slice(0, MAX_DOCS_PER_USER)
}

/**
 * El estado de "avisado" por mantenimiento de un usuario (`users/{uid}/ruleNotices/{ruleId}`).
 */
async function noticesOf(uid: string) {
  const snap = await adminDb().collection('users').doc(uid).collection('ruleNotices').limit(MAX_DOCS_PER_USER).get()
  const map = new Map<string, RuleNotice>()
  for (const d of snap.docs) map.set(d.id, serverNoticeFrom(d.data()))
  return map
}

/**
 * Cuántos trabajos pendientes de revisión tiene el dueño entre sus autos compartidos, y el id del auto si todos son
 * del mismo (para que el aviso lleve directo a la pestaña de trabajos de ese auto).
 */
async function pendingReviewOf(ownSharedCars: { doc: QueryDocumentSnapshot; car: Car }[]) {
  if (!ownSharedCars.length) return { count: 0, carId: null }
  const snaps = await Promise.all(
    ownSharedCars.map(({ doc }) => doc.ref.collection('jobs').where('status', '==', 'pending').limit(MAX_DOCS_PER_USER).get()),
  )
  let count = 0
  const carsWithPending = new Set<string>()
  snaps.forEach((snap, i) => {
    if (!snap.size) return
    count += snap.size
    carsWithPending.add(ownSharedCars[i].car.id)
  })
  return { count, carId: carsWithPending.size === 1 ? [...carsWithPending][0] : null }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest()

/** Compara el header con el secret en tiempo constante; los hashes igualan el largo para timingSafeEqual. */
function authorized(header: string | null) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return timingSafeEqual(sha256(header ?? ''), sha256(`Bearer ${secret}`))
}

/**
 * Toma el turno del día en `cronRuns/{fecha}` de forma atómica. Si el día ya terminó, o hay otra corrida en curso
 * dentro de `RUN_LOCK_MS`, no escribe nada; si no, marca `runningSince` y deja `finishedAt: null`.
 */
async function claimRun(runRef: DocumentReference, now: Date) {
  return adminDb().runTransaction(async tx => {
    const snap = await tx.get(runRef)
    const data = snap.data()
    const previous = data ? runStateFrom(data) : null
    if (runIsDone(previous)) return { status: 'done' as const }
    if (runIsBusy(previous, now)) return { status: 'busy' as const }
    const started = Timestamp.fromDate(now)
    tx.set(
      runRef,
      {
        ...(snap.exists ? {} : { startedAt: started }),
        runningSince: started,
        finishedAt: null,
        runs: FieldValue.increment(1),
      },
      { merge: true },
    )
    return { status: 'claimed' as const, previous }
  })
}

/**
 * Guarda el cierre de la corrida en `cronRuns/{fecha}` con un reintento. Si no se guarda, la próxima corrida volvería
 * a ver `finishedAt: null` con el cursor viejo: devuelve `false` para que la respuesta no marque `ok: true`.
 */
async function saveRunSummary(runRef: DocumentReference, date: string, summary: CronRunSummary) {
  const data = { ...summary, finishedAt: Timestamp.fromDate(new Date()) }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await runRef.set(data, { merge: true })
      return true
    } catch (e) {
      if (attempt === 1) console.error('Cron: no se guardó el registro de la corrida', date, e)
    }
  }
  return false
}

/**
 * Manda los avisos del día a un usuario (dueño y miembro) y guarda cuáles se avisaron en `users/{uid}/ruleNotices/{ruleId}`.
 * Los recordatorios cumplidos (`completedByJobId`) no se avisan (`planDailyNotifications` los saltea). El km de cada
 * auto es el de su lectura más alta (`carKmForNotifications`), no el `currentKm` guardado. Los mantenimientos, las
 * lecturas de km, los `ruleNotices` del usuario y los trabajos pendientes de sus autos compartidos se piden a la vez.
 * Cuando se leyeron todos los autos y mantenimientos del usuario (`sharedCars !== false` y sin llegar al tope), borra
 * con el mismo `bulkWriter` los `ruleNotices` huérfanos (`orphanNoticeIds`: mantenimientos o autos borrados, o autos de
 * los que salió). Un uid con suscripciones pero sin `users/{uid}` no tiene ajustes: cuenta como procesado sin mensajes.
 * Los autos marcados como borrados (`deletedAt`) no cuentan: ya no existen para el usuario, y sus `ruleNotices` quedan
 * huérfanos.
 */
async function processUser(uid: string, now: Date): Promise<CronUserReport> {
  const db = adminDb()
  const userDoc = await db.collection('users').doc(uid).get()
  const x = userDoc.data()
  if (!x) return { uid, messages: 0, sent: 0 }
  const settings = serverSettingsFrom(x)
  const [ownSnap, sharedSnap] = await Promise.all([
    db.collection('cars').where('ownerUid', '==', uid).limit(MAX_DOCS_PER_USER).get(),
    settings.sharedCars
      ? db.collection('cars').where('memberUids', 'array-contains', uid).limit(MAX_DOCS_PER_USER).get()
      : Promise.resolve(null),
  ])
  const seen = new Set<string>()
  const carDocs: QueryDocumentSnapshot[] = []
  for (const d of [...ownSnap.docs, ...(sharedSnap?.docs ?? [])]) {
    if (seen.has(d.id) || d.get('deletedAt') != null || carDocs.length >= MAX_DOCS_PER_USER) continue
    seen.add(d.id)
    carDocs.push(d)
  }
  const rawCars = carDocs.map(d => ({ doc: d, car: serverCarFrom(d.id, d.data()) }))
  const ownShared = rawCars.filter(({ car }) => car.ownerUid === uid && isSharedCar(car, uid))
  const [rules, tops, notices, pendingReview] = await Promise.all([
    rulesOf(carDocs),
    Promise.all(carDocs.map(topReadingOf)),
    noticesOf(uid),
    pendingReviewOf(ownShared),
  ])
  const { messages, ruleUpdates } = planDailyNotifications({
    settings,
    cars: rawCars.map(({ car }, i) => carKmForNotifications(car, tops[i])),
    rules,
    today: todayInTimeZone(settings.timezone, now),
    now,
    uid,
    notices,
    pendingReview,
  })

  const { sent, delivered } = await sendToUser(uid, messages)
  const updates = updatesToPersist(ruleUpdates, delivered)
  const orphans =
    settings.sharedCars && carDocs.length < MAX_DOCS_PER_USER && rules.length < MAX_DOCS_PER_USER
      ? orphanNoticeIds(notices, rules)
      : []
  if (updates.length || orphans.length) {
    const writer = db.bulkWriter()
    writer.onWriteError(err => err.code !== 5 && err.failedAttempts < 3)
    const noticesCol = db.collection('users').doc(uid).collection('ruleNotices')
    for (const u of updates) {
      writer
        .set(noticesCol.doc(u.ruleId), {
          status: u.lastNotifiedStatus,
          at: u.notified ? Timestamp.fromDate(now) : null,
        })
        .catch(e => {
          if (e.code !== 5) console.error('Cron: no se guardó el aviso', uid, u.ruleId, e)
        })
    }
    for (const ruleId of orphans) {
      writer.delete(noticesCol.doc(ruleId)).catch(e => {
        if (e.code !== 5) console.error('Cron: no se borró el aviso huérfano', uid, ruleId, e)
      })
    }
    await writer.close()
  }
  return { uid, messages: messages.length, sent }
}

/**
 * Barrido de autos borrados: termina de borrar (`purgeCar`) los autos marcados (`deletedAt`) hace más de
 * `PURGE_DELAY_MS` (`purgeCutoff`), que la app no llegó a borrar (se cerró antes de llamar a `DELETE /api/cars/[carId]`,
 * la marca se sincronizó sin la app abierta, o Cloudinary falló). La consulta usa el índice simple automático de
 * `deletedAt`. Borra de a un auto y no empieza otro pasado `SWEEP_BUDGET_MS`. Nunca tira: un error se cuenta en el
 * reporte y va a los logs, así no frena los avisos.
 */
async function sweepDeletedCars(now: Date, startedAt: number): Promise<SweepReport> {
  const report: SweepReport = { found: 0, purged: 0, photoPending: 0, errors: 0 }
  let docs: QueryDocumentSnapshot[] = []
  try {
    const snap = await adminDb()
      .collection('cars')
      .where('deletedAt', '<', Timestamp.fromDate(purgeCutoff(now)))
      .orderBy('deletedAt')
      .limit(SWEEP_LIMIT)
      .get()
    docs = snap.docs
  } catch (e) {
    console.error('Cron: no se pudieron leer los autos borrados', e)
    return { ...report, error: (e as Error).message }
  }
  report.found = docs.length
  for (const d of docs) {
    if (Date.now() - startedAt >= SWEEP_BUDGET_MS) break
    try {
      const { photo } = await purgeCar(d.ref, serverCarFrom(d.id, d.data()))
      if (photo === 'pending') report.photoPending++
      else report.purged++
    } catch (e) {
      report.errors++
      console.error('Cron: no se pudo terminar de borrar el auto', d.id, e)
    }
  }
  return report
}

/**
 * Vercel Cron la llama dos veces por día (ver vercel.json) con "Authorization: Bearer $CRON_SECRET". Toma el turno en
 * `cronRuns/{fecha}` con una transacción: sin registro procesa a todos; si ya terminó sin dejar a nadie afuera,
 * responde `alreadyDone`; si otra llamada está corriendo dentro de `RUN_LOCK_MS`, responde `busy`; si no, sigue
 * después del cursor. Solo se procesan los usuarios con suscripción push, en orden de uid, leyendo `users/{uid}` por
 * cada uno que se procesa. Cada worker toma el próximo usuario hasta que no quedan o se acaba el tiempo; el error de
 * un usuario no corta a los demás. Si quedan usuarios afuera o hay errores, va un `console.error` para que salte en
 * los logs de Vercel.
 * En paralelo con los usuarios corre el barrido de autos borrados (`sweepDeletedCars`, con su propio tope de tiempo),
 * también cuando el día ya está hecho (`alreadyDone`), y no cuando otra llamada está en curso (`busy`: la barre esa).
 * No toca el turno, el cursor ni las métricas de `cronRuns/{fecha}`: su resultado va sólo en la respuesta (`sweep`), y
 * el cierre de la corrida se guarda sin esperarlo, así un auto que tarda en borrarse no deja la corrida sin cerrar.
 */
export async function GET(request: Request) {
  const startedAt = Date.now()
  if (!authorized(request.headers.get('authorization'))) {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }

  const db = adminDb()
  const now = new Date()
  const date = runDateOf(now)
  const runRef = db.collection('cronRuns').doc(date)
  const claim = await claimRun(runRef, now)
  if (claim.status === 'done') {
    const sweep = await sweepDeletedCars(now, startedAt)
    return Response.json({ ok: true, date, alreadyDone: true, sweep })
  }
  if (claim.status === 'busy') return Response.json({ ok: true, date, busy: true })
  const { previous } = claim

  const subs = await db.collectionGroup('pushSubscriptions').select().get()
  const uids = candidateUids(subs.docs.map(d => d.ref.path))
  const queue = queueFrom(uids, previous)
  const report: CronUserReport[] = []

  let next = 0
  const worker = async () => {
    while (next < queue.length && Date.now() - startedAt < TIME_BUDGET_MS) {
      const uid = queue[next++]
      try {
        report.push(await processUser(uid, now))
      } catch (e) {
        console.error('Cron: error con usuario', uid, e)
        report.push({ uid, messages: 0, sent: 0, error: (e as Error).message })
      }
    }
  }
  const sweeping = sweepDeletedCars(now, startedAt)
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const summary = summarizeRun({ queue, next, reports: report, candidates: uids.length, previous })
  const run = tally(report)
  const logged = await saveRunSummary(runRef, date, summary)
  const sweep = await sweeping

  if (summary.skipped || run.errors) {
    console.error(
      `Cron ${date}: quedaron ${summary.skipped} de ${queue.length} usuarios sin procesar y ${run.errors} con error`,
      summary.failures,
    )
  }
  return Response.json(
    {
      ok: logged,
      date,
      candidates: uids.length,
      processed: run.processed,
      skipped: summary.skipped,
      errors: run.errors,
      sent: run.sent,
      report,
      sweep,
    },
    logged ? undefined : { status: 500 },
  )
}
