/** Canal entre pestañas de AutoCar (`BroadcastChannel`). */
export const DEVICE_CHANNEL = 'autocar'

/** Mensaje del canal: una pestaña está cerrando la sesión de `uid` y las demás tienen que soltar la caché de Firestore. */
export interface SignOutMessage {
  type: 'signout'
  uid: string
}

/** Claves de localStorage que son preferencias del dispositivo, no datos de una cuenta: sobreviven a "Salir". */
export const DEVICE_PREFERENCE_KEYS: readonly string[] = ['autocar:novedades-vistas']

/** Prefijos de claves de preferencias del dispositivo (p. ej. `autocar:aviso-oculto:{id}`): sobreviven a "Salir". */
export const DEVICE_PREFERENCE_PREFIXES: readonly string[] = ['autocar:aviso-oculto:']

/** Cuánto se espera a que se borre la caché de Firestore antes de volver a avisar a las otras pestañas. */
export const CLEAR_WAIT_MS = 2_000

/** Veces que se espera a que se borre la caché de Firestore (avisando a las otras pestañas entre una y otra). */
export const CLEAR_ATTEMPTS = 3

/** Cuánto se espera a que se borre la suscripción push de este dispositivo (sin señal no termina nunca). */
export const PUSH_CLEANUP_MS = 3_000

/** Cuánto espera otra pestaña a que la sesión se cierre antes de recargar igual (la que salía pudo fallar). */
export const FOLLOWER_RELOAD_MS = 15_000

/** El mensaje que manda la pestaña que sale. */
export const signOutMessage =(uid: string): SignOutMessage => ({ type: 'signout', uid })

/** Si lo que llegó por el canal es un `SignOutMessage`. */
export function isSignOutMessage(data: unknown): data is SignOutMessage {
  if (data == null || typeof data !== 'object') return false
  const message = data as Record<string, unknown>
  return message.type === 'signout' && typeof message.uid === 'string' && message.uid.length > 0
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

/** Confirmación de "Salir" cuando la bandeja tiene cambios que no llegaron al servidor; null si no hay ninguno. */
export function unsavedChangesWarning(count: number): { title: string; description: string; confirmLabel: string } | null {
  if (count <= 0) return null
  const description =
    count === 1 ? 'Tenés 1 cambio sin guardar; si salís se pierde.' : `Tenés ${count} cambios sin guardar; si salís se pierden.`
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
