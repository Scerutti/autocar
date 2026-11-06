'use client'

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { getAuth, type Auth } from 'firebase/auth'
import {
  clearIndexedDbPersistence,
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  terminate,
  type Firestore,
} from 'firebase/firestore'
import { CLEAR_WAIT_MS, TERMINATE_WAIT_MS, settleWithin } from '@/lib/sign-out'

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
}

export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId && config.appId)

let app: FirebaseApp | undefined
let auth: Auth | undefined
let db: Firestore | undefined

/** Mientras se cierra la sesión, nada vuelve a abrir Firestore (abrirlo volvería a crear la caché que se está borrando). */
let closing = false

/** App de Firebase, creada una sola vez. */
function firebaseApp() {
  if (!isFirebaseConfigured) throw new Error('Firebase no está configurado: completá las variables NEXT_PUBLIC_FIREBASE_* en .env.local')
  app ??= getApps().length ? getApp() : initializeApp(config)
  return app
}

export function firebaseAuth() {
  auth ??= getAuth(firebaseApp())
  return auth
}

/** Firestore con caché persistente: la app abre al instante y funciona sin señal (los cambios se sincronizan después). */
export function firestore() {
  if (closing) throw new Error('Se está cerrando la sesión')
  if (!db) {
    try {
      db = initializeFirestore(firebaseApp(), {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      })
    } catch {
      db = getFirestore(firebaseApp())
    }
  }
  return db
}

/**
 * Cierra Firestore en esta pestaña (`terminate`, hasta `TERMINATE_WAIT_MS`): suelta la caché de IndexedDB y corta los
 * listeners. La próxima llamada a `firestore()` crea otro, salvo con `hold`: la pestaña se va a recargar y hasta
 * entonces `firestore()` tira error (así nada vuelve a abrir la caché que otra pestaña está borrando).
 */
export async function releaseFirestore(hold = false) {
  if (hold) closing = true
  const instance = db
  db = undefined
  if (instance) await settleWithin(terminate(instance), TERMINATE_WAIT_MS)
}

/**
 * Borra la caché de Firestore de este dispositivo (IndexedDB, con las escrituras sin sincronizar): `terminate` →
 * `db = undefined` → `clearIndexedDbPersistence`, sobre una instancia cerrada (borra la misma base, que depende sólo
 * del proyecto y de la app, aunque esta pestaña nunca haya abierto Firestore). Cada `terminate` espera hasta
 * `TERMINATE_WAIT_MS` y sigue. Con este SDK, las otras pestañas que tienen la base abierta reciben el pedido de borrado
 * y cierran su Firestore solas; el borrado termina cuando la sueltan (una pestaña congelada o de una versión que no lo
 * hace lo deja esperando, y el navegador lo completa cuando se cierra). `clear` recibe la función que la borra y decide
 * cuánto esperar y si volver a avisar (`clearDeviceData`, `lib/sign-out-client.ts`). Mientras corre, `firestore()` tira
 * error. Devuelve lo que devuelve `clear`.
 */
export async function resetFirestore(clear: (run: () => Promise<void>) => Promise<boolean>) {
  closing = true
  try {
    await releaseFirestore().catch(() => undefined)
    const instance = getFirestore(firebaseApp())
    await settleWithin(terminate(instance), TERMINATE_WAIT_MS)
    return await clear(() => clearIndexedDbPersistence(instance))
  } finally {
    closing = false
  }
}

/**
 * Sin sesión (`/login`), borra la caché de Firestore que haya quedado de una cuenta anterior antes de que se abra
 * Firestore: p. ej. la que volvió a crear una pestaña que se abrió mientras otra salía. Si esta pestaña ya tiene
 * Firestore abierto, no hace nada. Espera el borrado hasta `CLEAR_WAIT_MS` (si otra pestaña la tiene abierta, queda
 * pedido). No marca la pestaña como cerrando: entrar enseguida abre Firestore después del borrado. Nunca tira.
 */
export async function clearSignedOutCache() {
  if (db || closing || !isFirebaseConfigured) return
  try {
    const instance = getFirestore(firebaseApp())
    await settleWithin(terminate(instance), TERMINATE_WAIT_MS)
    await settleWithin(clearIndexedDbPersistence(instance), CLEAR_WAIT_MS)
  } catch (e) {
    console.warn('No se pudo borrar la caché de Firestore', e)
  }
}
