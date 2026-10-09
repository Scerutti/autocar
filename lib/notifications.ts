import { weekdayOf } from './dates'
import { compareRuleStates, describeRemaining, getRuleState, type RuleState } from './maintenance'
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

/**
 * Tope de avisos por usuario y por corrida, contando el resumen: nadie recibe una catarata de
 * notificaciones y un usuario con miles de mantenimientos no alarga el cron de todos. Si hay más,
 * el último lugar es un resumen y los que no salieron no se marcan como avisados: salen otro día.
 */
export const MAX_MESSAGES_PER_RUN = 6

/** Tope de mantenimientos al día que se limpian por corrida: el batch de Firestore admite 500 escrituras. */
export const MAX_CLEARS_PER_RUN = 400

/** Tag del resumen "Y X avisos más": siempre el mismo, así reemplaza al del día anterior. */
export const MORE_TAG = 'more'

/** Tag del pedido de km de todos los autos juntos, cuando los de cada auto no entran en el tope. */
export const KM_TAG = 'km'

// Servicios de push de los navegadores: Chrome/Edge/Opera (FCM), Firefox, Edge en Windows (WNS) y Safari.
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
 */
export function planDailyNotifications(input: {
  settings: UserSettings
  cars: Car[]
  rules: MaintenanceRule[]
  today: ISODate
  now: Date
}): { messages: PushPayload[]; ruleUpdates: RuleNotificationUpdate[] } {
  const { settings, cars, rules, today, now } = input
  const ruleUpdates: RuleNotificationUpdate[] = []
  // Cada aviso de mantenimiento con la actualización a guardar si se manda.
  const ruleCandidates: { message: PushPayload; update: RuleNotificationUpdate; state: RuleState }[] = []
  const kmMessages: PushPayload[] = []

  if (settings.reminder.enabled && weekdayOf(today) === settings.reminder.weekday) {
    for (const car of cars) {
      kmMessages.push({
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
      // Las que pasan el tope se limpian en la próxima corrida.
      if (rule.lastNotifiedStatus && ruleUpdates.length < MAX_CLEARS_PER_RUN)
        ruleUpdates.push({ ruleId: rule.id, lastNotifiedStatus: null, notified: false })
      continue
    }

    const escalated = rule.lastNotifiedStatus !== state.status
    const stale = !rule.lastNotifiedAt || now.getTime() - rule.lastNotifiedAt.getTime() >= RENOTIFY_DAYS * 86_400_000 - 3_600_000
    if (!escalated && !stale) continue

    const r = describeRemaining(state)
    const detail = [r.km, r.date].filter(Boolean).join(' · ')
    ruleCandidates.push({
      message: {
        title: `${state.status === 'overdue' ? 'Vencido' : 'Se acerca'}: ${rule.name}`,
        body: `${nameOf(car)} — ${detail}`,
        url: `/autos/${car.id}/mantenimientos/${rule.id}`,
        tag: ruleTag(rule.id),
      },
      update: { ruleId: rule.id, lastNotifiedStatus: state.status, notified: true },
      state,
    })
  }

  // El pedido de km no se guarda en ningún lado, así que nunca se recorta: si no entra todo, los de
  // varios autos van en un solo mensaje (desde el inicio se cargan los km de cada uno) con lugar reservado.
  const allFit = ruleCandidates.length + kmMessages.length <= MAX_MESSAGES_PER_RUN
  const km =
    allFit || kmMessages.length <= 1
      ? kmMessages
      : [{ title: '¿Cuántos km tienen tus autos?', body: `Tocá para cargar los km de tus ${cars.length} autos.`, url: '/', tag: KM_TAG }]

  // Si no entran todos los avisos: primero los vencidos, después los por vencer (los más urgentes antes).
  ruleCandidates.sort((a, b) => compareRuleStates(a.state, b.state))
  const ruleSlots = MAX_MESSAGES_PER_RUN - km.length
  const fits = ruleCandidates.length <= ruleSlots
  const kept = fits ? ruleCandidates : ruleCandidates.slice(0, ruleSlots - 1)

  const messages = [...kept.map(c => c.message), ...km]
  // Sólo se guardan como avisados los que se mandan; el resto vuelve a salir en otra corrida.
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
