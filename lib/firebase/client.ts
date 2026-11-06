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
 * Cierra Firestore en esta pestaña (`terminate`): suelta la caché de IndexedDB y corta los listeners. La próxima
 * llamada a `firestore()` crea otro, salvo con `hold`: la pestaña se va a recargar y hasta entonces `firestore()` tira
 * error (así nada vuelve a abrir la caché que otra pestaña está borrando).
 */
export async function releaseFirestore(hold = false) {
  if (hold) closing = true
  const instance = db
  db = undefined
  if (instance) await terminate(instance)
}

/**
 * Borra la caché de Firestore de este dispositivo (IndexedDB, con las escrituras sin sincronizar): `terminate` →
 * `db = undefined` → `clearIndexedDbPersistence`, sobre una instancia cerrada (borra la misma base, que depende sólo
 * del proyecto y de la app, aunque esta pestaña nunca haya abierto Firestore). `clearIndexedDbPersistence` no termina
 * mientras otra pestaña tenga la base abierta: `clear` recibe la función que la borra y decide cuánto esperar y cómo
 * avisarles a las otras (`clearDeviceData`, `lib/sign-out-client.ts`). Mientras corre, `firestore()` tira error.
 * Devuelve lo que devuelve `clear`.
 */
export async function resetFirestore(clear: (run: () => Promise<void>) => Promise<boolean>) {
  closing = true
  try {
    await releaseFirestore().catch(() => undefined)
    const instance = getFirestore(firebaseApp())
    await terminate(instance)
    return await clear(() => clearIndexedDbPersistence(instance))
  } finally {
    closing = false
  }
}
