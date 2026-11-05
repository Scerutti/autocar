import { createHash, timingSafeEqual } from 'node:crypto'
import { FieldValue, Timestamp, type DocumentData, type DocumentReference, type QueryDocumentSnapshot } from 'firebase-admin/firestore'
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
import { planDailyNotifications, updatesToPersist } from '@/lib/notifications'
import { carKmForNotifications } from '@/lib/odometer'
import { fuelTypesFromDoc, intervalFromDoc } from '@/lib/parse'
import { sendToUser } from '@/lib/push-server'
import { DEFAULT_SETTINGS, type Car, type MaintenanceRule, type UserSettings } from '@/lib/types'

export const maxDuration = 60

/**
 * Pasado este tiempo no se empiezan usuarios nuevos: los que están en curso tienen margen para
 * terminar antes de maxDuration (cada uno tarda a lo sumo un timeout de push más las lecturas).
 */
const TIME_BUDGET_MS = 40_000

/** Usuarios que se procesan a la vez: lo lento es esperar a Firestore y a los servicios de push. */
const CONCURRENCY = 5

/**
 * Tope de autos, y de mantenimientos entre todos sus autos, que se leen por usuario: nadie con datos de más alarga el
 * cron de todos. De las lecturas de km se lee una por auto, así que también quedan dentro del tope.
 */
const MAX_DOCS_PER_USER = 1000

const toDate = (v: unknown) => (v instanceof Timestamp ? v.toDate() : null)
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function carFrom(id: string, x: DocumentData): Car {
  return {
    id,
    brand: x.brand ?? '',
    model: x.model ?? '',
    version: x.version ?? null,
    year: num(x.year),
    plate: x.plate ?? null,
    fuelTypes: fuelTypesFromDoc(x.fuelTypes),
    currentKm: num(x.currentKm) ?? 0,
    kmUpdatedAt: toDate(x.kmUpdatedAt),
    avgKmPerDay: num(x.avgKmPerDay),
    photoUrl: x.photoUrl ?? null,
    photoPublicId: x.photoPublicId ?? null,
    createdAt: toDate(x.createdAt) ?? new Date(0),
  }
}

/**
 * Un mantenimiento como lo usa el cron: la proyección guardada (`lastDone*`, `completedByJobId`), sin leer trabajos.
 * La base, como en `ruleFrom` de lib/db.ts: si el documento no tiene los campos (versión anterior de la PWA), es la
 * "última vez" guardada.
 */
function ruleFrom(id: string, x: DocumentData): MaintenanceRule {
  const legacy = !('baseDate' in x)
  return {
    id,
    carId: x.carId,
    name: x.name ?? '',
    intervalKm: num(x.intervalKm),
    intervalTime: intervalFromDoc(x),
    repeat: x.repeat !== false,
    baseKm: num(legacy ? x.lastDoneKm : x.baseKm),
    baseDate: (legacy ? x.lastDoneDate : x.baseDate) ?? null,
    lastDoneKm: num(x.lastDoneKm),
    lastDoneKmEstimated: x.lastDoneKmEstimated === true,
    lastDoneDate: x.lastDoneDate ?? null,
    lastDoneJobId: x.lastDoneJobId ?? null,
    completedByJobId: x.completedByJobId ?? null,
    warnKm: num(x.warnKm) ?? 500,
    warnDays: num(x.warnDays) ?? 30,
    lastNotifiedAt: toDate(x.lastNotifiedAt),
    lastNotifiedStatus: x.lastNotifiedStatus ?? null,
  }
}

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
 * La lectura de más km de un auto: la primera ordenando por km de mayor a menor, que usa el índice simple
 * automático. null si no tiene lecturas (las que no tienen km no entran en la consulta).
 */
async function topReadingOf(carDoc: QueryDocumentSnapshot) {
  const snap = await carDoc.ref.collection('odometer').orderBy('km', 'desc').limit(1).get()
  const x = snap.docs[0]?.data()
  const km = num(x?.km)
  return km == null ? null : { km, date: toDate(x?.date) }
}

/**
 * Los mantenimientos de todos los autos a la vez, con tope `MAX_DOCS_PER_USER` por auto y sobre el total, así un auto
 * con muchos mantenimientos aprovecha el cupo libre de los demás.
 */
async function rulesOf(carDocs: QueryDocumentSnapshot[]) {
  const snaps = await Promise.all(carDocs.map(carDoc => carDoc.ref.collection('rules').limit(MAX_DOCS_PER_USER).get()))
  return snaps
    .flatMap(snap => snap.docs.map(d => ruleFrom(d.id, d.data())))
    .slice(0, MAX_DOCS_PER_USER)
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
 * Manda los avisos del día a un usuario y guarda cuáles se avisaron. Los recordatorios cumplidos (`completedByJobId`)
 * no se avisan (`planDailyNotifications` los saltea). El km de cada auto es el de su lectura más alta
 * (`carKmForNotifications`), no el `currentKm` guardado, que sólo se corrige cuando alguien abre la app. Los
 * mantenimientos y las lecturas de todos los autos se piden a la vez. Las escrituras son independientes (no
 * un batch): si se borró un mantenimiento, los demás se guardan igual. El código 5 (NOT_FOUND) es un mantenimiento
 * que se borró mientras corría el cron: no hay nada que guardar. Un uid con suscripciones pero sin `users/{uid}` no
 * tiene ajustes: cuenta como procesado sin mensajes.
 */
async function processUser(uid: string, now: Date): Promise<CronUserReport> {
  const db = adminDb()
  const userDoc = await db.collection('users').doc(uid).get()
  const x = userDoc.data()
  if (!x) return { uid, messages: 0, sent: 0 }
  const settings: UserSettings = {
    reminder: { ...DEFAULT_SETTINGS.reminder, ...(x.reminder ?? {}) },
    timezone: x.timezone ?? DEFAULT_SETTINGS.timezone,
  }
  const carsSnap = await db.collection('cars').where('ownerUid', '==', uid).limit(MAX_DOCS_PER_USER).get()
  const [rules, tops] = await Promise.all([rulesOf(carsSnap.docs), Promise.all(carsSnap.docs.map(topReadingOf))])
  const carIdByRule = new Map(rules.map(r => [r.id, r.carId]))
  const { messages, ruleUpdates } = planDailyNotifications({
    settings,
    cars: carsSnap.docs.map((d, i) => carKmForNotifications(carFrom(d.id, d.data()), tops[i])),
    rules,
    today: todayInTimeZone(settings.timezone, now),
    now,
  })

  const { sent, delivered } = await sendToUser(uid, messages)
  const updates = updatesToPersist(ruleUpdates, delivered)
  if (updates.length) {
    const writer = db.bulkWriter()
    writer.onWriteError(err => err.code !== 5 && err.failedAttempts < 3)
    for (const u of updates) {
      writer
        .update(db.collection('cars').doc(carIdByRule.get(u.ruleId)!).collection('rules').doc(u.ruleId), {
          lastNotifiedStatus: u.lastNotifiedStatus,
          lastNotifiedAt: u.notified ? Timestamp.fromDate(now) : null,
        })
        .catch(e => {
          if (e.code !== 5) console.error('Cron: no se guardó el aviso', uid, u.ruleId, e)
        })
    }
    await writer.close()
  }
  return { uid, messages: messages.length, sent }
}

/**
 * Vercel Cron la llama dos veces por día (ver vercel.json) con "Authorization: Bearer $CRON_SECRET". Toma el turno en
 * `cronRuns/{fecha}` con una transacción: sin registro procesa a todos; si ya terminó sin dejar a nadie afuera,
 * responde `alreadyDone`; si otra llamada está corriendo dentro de `RUN_LOCK_MS`, responde `busy`; si no, sigue
 * después del cursor. Solo se procesan los usuarios con suscripción push, en orden de uid, leyendo `users/{uid}` por
 * cada uno que se procesa. Cada worker toma el próximo usuario hasta que no quedan o se acaba el tiempo; el error de
 * un usuario no corta a los demás. Si quedan usuarios afuera o hay errores, va un `console.error` para que salte en
 * los logs de Vercel.
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
  if (claim.status === 'done') return Response.json({ ok: true, date, alreadyDone: true })
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
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const summary = summarizeRun({ queue, next, reports: report, candidates: uids.length, previous })
  const run = tally(report)
  const logged = await saveRunSummary(runRef, date, summary)

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
    },
    logged ? undefined : { status: 500 },
  )
}
