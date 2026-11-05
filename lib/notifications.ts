import { weekdayOf } from './dates'
import { compareRuleStates, describeRemaining, getRuleState, isCompleted, type RuleState, type RuleStatus } from './maintenance'
import { canWrite, isCarOwner } from './sharing'
import type { Car, ISODate, Job, MaintenanceRule, RuleNotice, UserSettings } from './types'

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

export type JobNotificationEvent = 'submitted' | 'approved' | 'rejected'

export interface RuleAlert {
  rule: MaintenanceRule
  state: RuleState
  status: 'soon' | 'overdue'
  message: PushPayload
}

const RENOTIFY_DAYS = 7

/**
 * Tope de avisos por usuario y por corrida, contando el resumen: nadie recibe una catarata de
 * notificaciones y un usuario con miles de mantenimientos no alarga el cron de todos. Si hay más,
 * el último lugar es un resumen y los que no salieron no se marcan como avisados: salen otro día.
 */
export const MAX_MESSAGES_PER_RUN = 6

/**
 * Tope de mantenimientos al día que se limpian por corrida: el batch de Firestore admite 500 escrituras.
 * Los que pasan el tope se limpian en la próxima corrida.
 */
export const MAX_CLEARS_PER_RUN = 400

/** Tag del resumen "Y X avisos más": siempre el mismo, así reemplaza al del día anterior. */
export const MORE_TAG = 'more'

/** Tag del pedido de km de todos los autos juntos, cuando los de cada auto no entran en el tope. */
export const KM_TAG = 'km'

/** Tag del resumen diario de trabajos pendientes de revisión para el dueño. */
export const REVIEW_TAG = 'review'

/** Servicios de push de los navegadores: Chrome/Edge/Opera (FCM), Firefox, Edge en Windows (WNS) y Safari. */
const PUSH_HOSTS = ['.googleapis.com', '.mozilla.com', '.windows.com', '.apple.com']

/**
 * La URL de cada suscripción la guarda el navegador en Firestore: antes de que el servidor le haga un
 * request, se comprueba que sea de un servicio de push y no cualquier dirección.
 */
export function isPushEndpoint(endpoint: unknown): endpoint is string {
  try {
    const url = new URL(String(endpoint))
    return url.protocol === 'https:' && PUSH_HOSTS.some(h => url.hostname.endsWith(h))
  } catch {
    return false
  }
}

const nameOf = (car: Pick<Car, 'brand' | 'model'>) => `${car.brand} ${car.model}`.trim()

/** Tag del aviso de un mantenimiento: identifica el mensaje para saber si llegó. */
export const ruleTag = (ruleId: string) => `rule-${ruleId}`

/**
 * Mensaje push de un mantenimiento por vencer o vencido: el mismo texto y tag en el cron diario y en los avisos al
 * momento (`/api/notify/rules`), así el tag reemplaza la notificación en el dispositivo.
 */
export function ruleAlertMessage(car: Pick<Car, 'id' | 'brand' | 'model'>, rule: Pick<MaintenanceRule, 'id' | 'name'>, state: RuleState): PushPayload {
  const r = describeRemaining(state)
  const detail = [r.km, r.date].filter(Boolean).join(' · ')
  return {
    title: `${state.status === 'overdue' ? 'Vencido' : 'Se acerca'}: ${rule.name}`,
    body: `${nameOf(car)} — ${detail}`,
    url: `/autos/${car.id}/mantenimientos/${rule.id}`,
    tag: ruleTag(rule.id),
  }
}

/**
 * Estado de "avisado" de un mantenimiento para una persona (`users/{uid}/ruleNotices/{ruleId}`). Si la persona ya
 * tiene su propio registro (incluso con `status: null`, porque volvió a estar al día), manda ese. Si no existe y es el
 * dueño del auto, usa `rule.lastNotified*` como valor inicial para no repetir lo que ya le avisó el cron viejo; para
 * un miembro sin registro empieza en `null`.
 */
export function effectiveRuleNotice(
  rule: Pick<MaintenanceRule, 'lastNotifiedStatus' | 'lastNotifiedAt'>,
  owner: boolean,
  notice: RuleNotice | undefined,
): RuleNotice {
  if (notice !== undefined) return notice
  if (owner) return { status: rule.lastNotifiedStatus, at: rule.lastNotifiedAt }
  return { status: null, at: null }
}

/**
 * Si un mantenimiento subió de estado respecto del anterior (`ok`/`unknown`/`null` → `soon`/`overdue`, o
 * `soon` → `overdue`).
 */
export function didRuleEscalate(
  previous: RuleStatus | null | undefined,
  next: RuleStatus,
): next is 'soon' | 'overdue' {
  if (next === 'overdue') return previous !== 'overdue'
  if (next === 'soon') return previous !== 'soon' && previous !== 'overdue'
  return false
}

/**
 * Qué mantenimientos activos de un auto subieron de estado respecto del "avisado" de un destinatario (`notices`), sin
 * el re-aviso de los 7 días ni el tope del resumen diario: lo usa `POST /api/notify/rules` para avisar al momento a
 * cada integrante del auto (salvo quien cargó).
 */
export function planRuleAlerts(input: {
  car: Car
  rules: MaintenanceRule[]
  owner: boolean
  notices?: ReadonlyMap<string, RuleNotice>
  today: ISODate
}): RuleAlert[] {
  const { car, rules, owner, notices, today } = input
  const alerts: RuleAlert[] = []
  for (const rule of rules) {
    if (rule.carId !== car.id || isCompleted(rule)) continue
    const state = getRuleState(rule, car, today)
    const notice = effectiveRuleNotice(rule, owner, notices?.get(rule.id))
    if (!didRuleEscalate(notice.status, state.status)) continue
    alerts.push({ rule, state, status: state.status, message: ruleAlertMessage(car, rule, state) })
  }
  return alerts.sort((a, b) => compareRuleStates(a.state, b.state))
}

/**
 * Qué mantenimientos activos de un auto subieron de estado entre `before` y `after` de una escritura en el cliente
 * (`recordKm`, `saveFuel`, `saveJob` y sus "Deshacer"): sirve para mostrarle el toast "Ojo: …" a quien hizo la carga y
 * saber si vale la pena llamar a `/api/notify/rules` para el resto del grupo.
 */
export function escalatedRules(input: {
  carBefore: Pick<Car, 'currentKm' | 'avgKmPerDay'>
  carAfter: Pick<Car, 'currentKm' | 'avgKmPerDay'>
  rulesBefore: MaintenanceRule[]
  rulesAfter: MaintenanceRule[]
  today: ISODate
}): { rule: MaintenanceRule; state: RuleState; status: 'soon' | 'overdue' }[] {
  const { carBefore, carAfter, rulesBefore, rulesAfter, today } = input
  const beforeById = new Map(rulesBefore.map(r => [r.id, r]))
  const out: { rule: MaintenanceRule; state: RuleState; status: 'soon' | 'overdue' }[] = []
  for (const rule of rulesAfter) {
    if (isCompleted(rule)) continue
    const prevRule = beforeById.get(rule.id)
    const prevStatus = prevRule && !isCompleted(prevRule) ? getRuleState(prevRule, carBefore, today).status : null
    const state = getRuleState(rule, carAfter, today)
    if (didRuleEscalate(prevStatus, state.status)) {
      out.push({ rule, state, status: state.status })
    }
  }
  return out.sort((a, b) => compareRuleStates(a.state, b.state))
}

/**
 * Valida y arma el aviso al momento de un trabajo (`POST /api/notify/job`):
 * - `submitted`: quien llama es un miembro del auto y el autor del trabajo, y el trabajo está `pending` → avisa al dueño.
 * - `approved` / `rejected`: quien llama es el dueño, el trabajo está en ese estado y lo cargó un miembro → avisa al autor.
 * Devuelve `{ ok: true, recipientUid, noticeId, message }` o `{ ok: false }` (403).
 */
export function planJobNotification(input: {
  uid: string
  car: Car
  job: Job
  event: JobNotificationEvent
}): { ok: true; recipientUid: string; noticeId: string; message: PushPayload } | { ok: false } {
  const { uid, car, job, event } = input
  if (job.carId !== car.id || !car.ownerUid) return { ok: false }
  const status = job.status ?? 'approved'
  const revision = job.revision ?? 0
  const noticeId = `${job.id}_${event}_${revision}`
  const url = `/autos/${car.id}/trabajos/${job.id}`

  if (event === 'submitted') {
    const isMember = (car.memberUids ?? []).includes(uid)
    if (!isMember || job.createdBy !== uid || status !== 'pending') return { ok: false }
    return {
      ok: true,
      recipientUid: car.ownerUid,
      noticeId,
      message: {
        title: `Trabajo para revisar en ${nameOf(car)}`,
        body: `${job.createdByName || 'Un miembro'} cargó «${job.title}».`,
        url,
        tag: `job-review-${job.id}`,
      },
    }
  }

  if (event !== 'approved' && event !== 'rejected') return { ok: false }
  if (car.ownerUid !== uid || status !== event || !job.createdBy || job.createdBy === car.ownerUid) {
    return { ok: false }
  }
  return {
    ok: true,
    recipientUid: job.createdBy,
    noticeId,
    message:
      event === 'approved'
        ? {
            title: `Aprobaron tu trabajo en ${nameOf(car)}`,
            body: `«${job.title}» ya cuenta en gastos y mantenimientos.`,
            url,
            tag: `job-${job.id}`,
          }
        : {
            title: `Rechazaron tu trabajo en ${nameOf(car)}`,
            body: `«${job.title}» — tocá para corregirlo y volver a mandarlo.`,
            url,
            tag: `job-${job.id}`,
          },
  }
}

/**
 * Qué actualizaciones guardar después de enviar. Si el aviso de un mantenimiento no le llegó a ningún
 * dispositivo (no tiene, o fallaron todos) no se marca como avisado: se reintenta al día siguiente
 * en vez de esperar 7 días. Las que sólo limpian el estado se guardan siempre.
 */
export function updatesToPersist(ruleUpdates: RuleNotificationUpdate[], delivered: ReadonlySet<string>) {
  return ruleUpdates.filter(u => !u.notified || delivered.has(ruleTag(u.ruleId)))
}

/**
 * Decide qué avisos mandar hoy a un usuario. Es pura para poder testearla;
 * el cron se encarga de leer Firestore, enviar y persistir las actualizaciones.
 * Un recordatorio cumplido (`completedByJobId`) no se avisa: dejó de ser un mantenimiento activo. Un mantenimiento
 * que volvió a estar al día se limpia para que avise en el próximo ciclo. El estado de "avisado" sale de `notices`
 * (`users/{uid}/ruleNotices/{ruleId}`), con `rule.lastNotified*` como valor inicial para el dueño. Si
 * `settings.sharedCars === false`, se saltean los autos donde el usuario no es el dueño. A un miembro `viewer` no se
 * le piden los km (`canWrite`). El resumen de trabajos para revisar (`pendingReview`, sólo del dueño) y el pedido de
 * km no se guardan en ningún lado, así que tienen lugar reservado dentro de `MAX_MESSAGES_PER_RUN`. Si no entran todos
 * los avisos de mantenimientos, van primero los vencidos y después los por vencer (los más urgentes antes).
 */
export function planDailyNotifications(input: {
  settings: UserSettings
  cars: Car[]
  rules: MaintenanceRule[]
  today: ISODate
  now: Date
  uid?: string
  notices?: ReadonlyMap<string, RuleNotice>
  pendingReview?: { count: number; carId?: string | null }
}): { messages: PushPayload[]; ruleUpdates: RuleNotificationUpdate[] } {
  const { settings, rules, today, now, uid, notices, pendingReview } = input
  const allowShared = settings.sharedCars !== false
  const cars = uid && !allowShared ? input.cars.filter(c => !c.ownerUid || isCarOwner(c, uid)) : input.cars
  const ruleUpdates: RuleNotificationUpdate[] = []
  const ruleCandidates: { message: PushPayload; update: RuleNotificationUpdate; state: RuleState }[] = []
  const kmMessages: PushPayload[] = []

  const kmCars = uid ? cars.filter(c => !c.ownerUid || canWrite(c, uid)) : cars
  if (settings.reminder.enabled && weekdayOf(today) === settings.reminder.weekday) {
    for (const car of kmCars) {
      kmMessages.push({
        title: `¿Cuántos km tiene tu ${nameOf(car)}?`,
        body: `Tocá para cargarlos. Último registro: ${car.currentKm.toLocaleString('es-AR')} km.`,
        url: `/autos/${car.id}/km`,
        tag: `km-${car.id}`,
      })
    }
  }

  const reviewCount = pendingReview?.count ?? 0
  const reviewMessage: PushPayload | null =
    reviewCount > 0
      ? {
          title: reviewCount === 1 ? 'Tenés 1 trabajo para revisar' : `Tenés ${reviewCount} trabajos para revisar`,
          body: reviewCount === 1 ? 'Tocá para aprobarlo o rechazarlo.' : 'Tocá para aprobarlos o rechazarlos.',
          url: pendingReview?.carId ? `/autos/${pendingReview.carId}?tab=trabajos` : '/',
          tag: REVIEW_TAG,
        }
      : null
  const reviewSlots = reviewMessage ? 1 : 0

  const carById = new Map(cars.map(c => [c.id, c]))
  for (const rule of rules) {
    const car = carById.get(rule.carId)
    if (!car || isCompleted(rule)) continue
    const owner = !uid || !car.ownerUid || isCarOwner(car, uid)
    const notice = effectiveRuleNotice(rule, owner, notices?.get(rule.id))
    const state = getRuleState(rule, car, today)

    if (state.status !== 'soon' && state.status !== 'overdue') {
      if (notice.status && ruleUpdates.length < MAX_CLEARS_PER_RUN)
        ruleUpdates.push({ ruleId: rule.id, lastNotifiedStatus: null, notified: false })
      continue
    }

    const escalated = notice.status !== state.status
    const stale = !notice.at || now.getTime() - notice.at.getTime() >= RENOTIFY_DAYS * 86_400_000 - 3_600_000
    if (!escalated && !stale) continue

    ruleCandidates.push({
      message: ruleAlertMessage(car, rule, state),
      update: { ruleId: rule.id, lastNotifiedStatus: state.status, notified: true },
      state,
    })
  }

  const allFit = ruleCandidates.length + kmMessages.length + reviewSlots <= MAX_MESSAGES_PER_RUN
  const km =
    allFit || kmMessages.length <= 1
      ? kmMessages
      : [{ title: '¿Cuántos km tienen tus autos?', body: `Tocá para cargar los km de tus ${kmCars.length} autos.`, url: '/', tag: KM_TAG }]

  ruleCandidates.sort((a, b) => compareRuleStates(a.state, b.state))
  const ruleSlots = Math.max(0, MAX_MESSAGES_PER_RUN - km.length - reviewSlots)
  const fits = ruleCandidates.length <= ruleSlots
  const kept = fits ? ruleCandidates : ruleCandidates.slice(0, Math.max(0, ruleSlots - 1))

  const messages = [...kept.map(c => c.message), ...(reviewMessage ? [reviewMessage] : []), ...km]
  for (const c of kept) ruleUpdates.push(c.update)
  if (!fits) {
    const rest = ruleCandidates.length - kept.length
    messages.push({
      title: 'Tenés más avisos',
      body: rest === 1 ? 'Y 1 aviso más. Tocá para verlo.' : `Y ${rest} avisos más. Tocá para verlos.`,
      url: '/',
      tag: MORE_TAG,
    })
  }

  return { messages, ruleUpdates }
}
