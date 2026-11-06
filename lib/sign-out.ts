import { withoutExpired, type OutboxEntry } from './outbox'

/** Canal entre pestañas de AutoCar (`BroadcastChannel`). */
export const DEVICE_CHANNEL = 'autocar'

/**
 * Mensaje del canal: la pestaña `from` está cerrando la sesión de `uid` y las demás tienen que soltar la caché de
 * Firestore. `from` es el id de la pestaña que lo manda (`TAB_ID`, `lib/sign-out-client.ts`): ella misma lo ignora.
 */
export interface SignOutMessage {
  type: 'signout'
  uid: string
  from: string
}

/** Claves de localStorage que son preferencias del dispositivo, no datos de una cuenta: sobreviven a "Salir". */
export const DEVICE_PREFERENCE_KEYS: readonly string[] = ['autocar:novedades-vistas']

/** Prefijos de claves de preferencias del dispositivo (p. ej. `autocar:aviso-oculto:{id}`): sobreviven a "Salir". */
export const DEVICE_PREFERENCE_PREFIXES: readonly string[] = ['autocar:aviso-oculto:']

/** Cuánto se espera a que el servidor confirme las escrituras pendientes antes de preguntar si salir. */
export const PENDING_WRITES_WAIT_MS = 1_500

/** Cuánto se espera a que Firestore se cierre (`terminate`) antes de seguir igual. */
export const TERMINATE_WAIT_MS = 3_000

/** Cuánto se espera a que se borre la caché de Firestore antes de volver a avisar a las otras pestañas. */
export const CLEAR_WAIT_MS = 2_000

/** Veces que se espera a que se borre la caché de Firestore (avisando a las otras pestañas entre una y otra). */
export const CLEAR_ATTEMPTS = 3

/** Cuánto se espera cada paso de la desuscripción push de este dispositivo (sin señal, el borrado del documento no termina). */
export const PUSH_CLEANUP_MS = 3_000

/** Cuánto espera otra pestaña a que la sesión se cierre antes de recargar igual (la que salía pudo fallar). */
export const FOLLOWER_RELOAD_MS = 15_000

/** El mensaje que manda la pestaña `from` al cerrar la sesión de `uid`. */
export function signOutMessage(uid: string, from: string): SignOutMessage {
  return { type: 'signout', uid, from }
}

/** Si lo que llegó por el canal es un `SignOutMessage`. */
export function isSignOutMessage(data: unknown): data is SignOutMessage {
  if (data == null || typeof data !== 'object') return false
  const message = data as Record<string, unknown>
  return (
    message.type === 'signout' &&
    typeof message.uid === 'string' &&
    message.uid.length > 0 &&
    typeof message.from === 'string' &&
    message.from.length > 0
  )
}

/**
 * Si esta pestaña (`tabId`, con la sesión de `uid`, o sin sesión: null) sigue un aviso del canal: sólo si es un
 * `SignOutMessage` de otra pestaña y de la misma cuenta.
 */
export function followsSignOut(data: unknown, tabId: string, uid: string | null): boolean {
  return isSignOutMessage(data) && data.from !== tabId && uid != null && data.uid === uid
}

/**
 * Si una pestaña que no está saliendo tiene que irse a `/login` y soltar Firestore: la sesión que tenía se cerró
 * (en otra pestaña, o la cerró Firebase). Así una pestaña que no recibió el aviso del canal (se abrió mientras otra
 * salía, o sin `BroadcastChannel`) no vuelve a crear la caché con los datos de la cuenta que salió.
 */
export function leavesOnSignedOut({ hadUser, hasUser, leading }: { hadUser: boolean; hasUser: boolean; leading: boolean }) {
  return hadUser && !hasUser && !leading
}

/**
 * Claves de localStorage de la cuenta `uid` que se borran al salir: las `autocar:*:{uid}` (hoy la bandeja,
 * `autocar:outbox:{uid}`), sin las preferencias del dispositivo. Las de otras cuentas y las ajenas a AutoCar quedan.
 */
export function accountLocalKeys(keys: readonly string[], uid: string): string[] {
  if (!uid) return []
  return keys.filter(
    key =>
      key.startsWith('autocar:') &&
      key.endsWith(`:${uid}`) &&
      !DEVICE_PREFERENCE_KEYS.includes(key) &&
      !DEVICE_PREFERENCE_PREFIXES.some(prefix => key.startsWith(prefix)),
  )
}

/**
 * Lo que la bandeja tiene sin guardar al salir, sin las entradas vencidas (`withoutExpired`, que la bandeja ya no
 * muestra): `unsaved`, todas las que quedan; `pending`, las que esperan al servidor (son escrituras pendientes de Firestore).
 */
export function unsavedOutbox(entries: readonly OutboxEntry[], now: number): { unsaved: number; pending: number } {
  const live = withoutExpired([...entries], now)
  return { unsaved: live.length, pending: live.filter(e => e.state === 'pending').length }
}

/**
 * Confirmación de "Salir" cuando se perdería algo; null si no. `unsaved`: entradas de la bandeja. `writesPending`:
 * Firestore todavía tiene escrituras sin confirmar después de esperar `PENDING_WRITES_WAIT_MS`. Si la bandeja tiene
 * entradas `pending` (`outboxPending`), esas escrituras son las suyas y no se suman como "otros cambios"; si no, son
 * otras (aprobar un trabajo, Deshacer, invitaciones, que no pasan por la bandeja).
 */
export function signOutWarning({
  unsaved,
  outboxPending,
  writesPending,
}: {
  unsaved: number
  outboxPending: number
  writesPending: boolean
}): { title: string; description: string; confirmLabel: string } | null {
  const others = writesPending && outboxPending === 0
  if (unsaved <= 0 && !others) return null
  let description: string
  if (unsaved <= 0) description = 'Tenés cambios sin sincronizar; si salís se pierden.'
  else if (others)
    description = `Tenés ${unsaved} ${unsaved === 1 ? 'cambio' : 'cambios'} sin guardar y otros cambios sin sincronizar; si salís se pierden.`
  else if (unsaved === 1) description = 'Tenés 1 cambio sin guardar; si salís se pierde.'
  else description = `Tenés ${unsaved} cambios sin guardar; si salís se pierden.`
  return { title: '¿Salir con cambios sin guardar?', description, confirmLabel: 'Salir igual' }
}

/** Cómo terminó una espera con tope: la promesa resolvió, falló o se pasó del tiempo. */
export type Settled = 'done' | 'failed' | 'timeout'

/** Espera `promise` hasta `ms`. Nunca rechaza; si la promesa falla después del tope, el error se descarta. */
export function settleWithin(promise: Promise<unknown>, ms: number): Promise<Settled> {
  return new Promise<Settled>(resolve => {
    const timer = setTimeout(() => resolve('timeout'), ms)
    promise.then(
      () => {
        clearTimeout(timer)
        resolve('done')
      },
      () => {
        clearTimeout(timer)
        resolve('failed')
      },
    )
  })
}

/**
 * Reintenta `start` hasta que termine, con `attempts` esperas de `waitMs`. Si se pasa del tiempo, sigue esperando la
 * misma promesa (no la vuelve a empezar); si falla, la empieza de nuevo. Antes de cada espera después de la primera
 * llama a `onRetry`. Un `start` que tira al llamarlo cuenta como un fallo. Devuelve si terminó.
 */
export async function retryWithin(
  start: () => Promise<unknown>,
  { attempts, waitMs, onRetry }: { attempts: number; waitMs: number; onRetry?: () => void },
): Promise<boolean> {
  const begin = () => {
    try {
      return start()
    } catch (e) {
      return Promise.reject(e)
    }
  }
  let pending = begin()
  for (let attempt = 1; ; attempt++) {
    const result = await settleWithin(pending, waitMs)
    if (result === 'done') return true
    if (attempt >= attempts) return false
    onRetry?.()
    if (result === 'failed') pending = begin()
  }
}
