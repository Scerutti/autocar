'use client'

import { deletePushSubscription } from './db'
import { resetFirestore } from './firebase/client'
import { localKeys, writeLocal } from './local-store'
import { currentSubscription } from './push-client'
import {
  CLEAR_ATTEMPTS,
  CLEAR_WAIT_MS,
  DEVICE_CHANNEL,
  PUSH_CLEANUP_MS,
  accountLocalKeys,
  retryWithin,
  settleWithin,
  signOutMessage,
} from './sign-out'

/** Avisa a las otras pestañas de AutoCar que se cierra la sesión de `uid` (`DEVICE_CHANNEL`). */
export function broadcastSignOut(uid: string) {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(DEVICE_CHANNEL)
    channel.postMessage(signOutMessage(uid))
    channel.close()
  } catch (e) {
    console.warn('No se pudo avisar a las otras pestañas', e)
  }
}

/**
 * Desuscribe este dispositivo de los avisos push de `uid`: borra `users/{uid}/pushSubscriptions/{sha256(endpoint)}`
 * (con la sesión abierta, para que las reglas lo dejen) y después la suscripción del navegador. Sin señal el borrado
 * no termina: se espera hasta `PUSH_CLEANUP_MS` y se desuscribe igual (el servidor borra el documento la próxima vez
 * que el envío le dé 410). Nunca tira.
 */
async function unsubscribePush(uid: string) {
  try {
    const sub = await currentSubscription()
    if (!sub) return
    await settleWithin(deletePushSubscription(uid, sub.endpoint), PUSH_CLEANUP_MS)
    await sub.unsubscribe()
  } catch (e) {
    console.warn('No se pudo desuscribir este dispositivo de los avisos', e)
  }
}

/**
 * Borra los datos de la cuenta `uid` de este dispositivo, con la sesión todavía abierta: la suscripción push de este
 * dispositivo, la caché de Firestore (avisando a las otras pestañas por `DEVICE_CHANNEL` para que la suelten, y
 * reintentando) y las claves `autocar:*:{uid}` de localStorage (la bandeja). No cierra la sesión: eso es `signOut` de
 * `useAuth()`, que la llama. Devuelve false si la caché de Firestore no se pudo borrar (otra pestaña la sigue usando:
 * se borra sola cuando se cierre). Nunca tira.
 */
export async function clearDeviceData(uid: string): Promise<boolean> {
  await settleWithin(unsubscribePush(uid), PUSH_CLEANUP_MS + 1_000)
  broadcastSignOut(uid)
  let cleared = false
  try {
    cleared = await resetFirestore(run =>
      retryWithin(run, { attempts: CLEAR_ATTEMPTS, waitMs: CLEAR_WAIT_MS, onRetry: () => broadcastSignOut(uid) }),
    )
  } catch (e) {
    console.warn('No se pudo borrar la caché de Firestore', e)
  }
  for (const key of accountLocalKeys(localKeys(), uid)) writeLocal(key, null)
  return cleared
}
