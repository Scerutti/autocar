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

/** Id de esta pestaña en `DEVICE_CHANNEL`: lo lleva cada `SignOutMessage` que manda, y ella ignora los suyos. */
export const TAB_ID =
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`

/** Avisa a las otras pestañas de AutoCar que se cierra la sesión de `uid` (`DEVICE_CHANNEL`). */
export function broadcastSignOut(uid: string) {
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(DEVICE_CHANNEL)
    channel.postMessage(signOutMessage(uid, TAB_ID))
    channel.close()
  } catch (e) {
    console.warn('No se pudo avisar a las otras pestañas', e)
  }
}

/**
 * Desuscribe este dispositivo de los avisos push de `uid`. Primero la suscripción del navegador (no depende de
 * Firestore: desde ahí no llega nada más, y el servidor borra el documento con el próximo 410), después, si se puede,
 * `users/{uid}/pushSubscriptions/{sha256(endpoint)}` (con la sesión abierta, para que las reglas lo dejen). Cada paso
 * espera hasta `PUSH_CLEANUP_MS`. Al terminar, el borrado del documento queda cancelado: si todavía no tocó Firestore,
 * ya no lo hace (así no vuelve a abrirlo durante el borrado de la caché ni después). Nunca tira.
 */
async function unsubscribePush(uid: string) {
  let active = true
  try {
    const found = await settleAndGet(currentSubscription(), PUSH_CLEANUP_MS)
    if (!found) return
    const endpoint = found.endpoint
    await settleWithin(found.unsubscribe(), PUSH_CLEANUP_MS)
    await settleWithin(deletePushSubscription(uid, endpoint, () => active), PUSH_CLEANUP_MS)
  } catch (e) {
    console.warn('No se pudo desuscribir este dispositivo de los avisos', e)
  } finally {
    active = false
  }
}

/** El valor de `promise` si resuelve antes de `ms`; null si falla o se pasa del tiempo. */
async function settleAndGet<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let value: T | null = null
  const result = await settleWithin(
    promise.then(v => {
      value = v
    }),
    ms,
  )
  return result === 'done' ? value : null
}

/**
 * Borra los datos de la cuenta `uid` de este dispositivo, con la sesión todavía abierta: la suscripción push de este
 * dispositivo, la caché de Firestore (avisando a las otras pestañas por `DEVICE_CHANNEL` con `TAB_ID`, y reintentando)
 * y las claves `autocar:*:{uid}` de localStorage (la bandeja). No cierra la sesión: eso es `signOut` de `useAuth()`, que
 * la llama, y es lo que hay que usar (`signOut({ skipConfirm: true })`). Llamarla sola es seguro (esta pestaña ignora su
 * propio aviso), pero cierra el Firestore de esta pestaña: lo que esté montado y lo vuelva a pedir abre una caché
 * nueva, así que después hay que cerrar la sesión. Devuelve false si la caché de Firestore no se terminó de borrar
 * (otra pestaña la sigue usando: el navegador la borra cuando se cierre). Nunca tira.
 */
export async function clearDeviceData(uid: string): Promise<boolean> {
  await unsubscribePush(uid)
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
