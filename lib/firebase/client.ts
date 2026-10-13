'use client'

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { getAuth, type Auth } from 'firebase/auth'
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
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
let appCheckReady = false

/**
 * App de Firebase, con App Check (reCAPTCHA Enterprise): Firestore sólo acepta pedidos que vienen de la
 * app, no de un script. App Check se inicia antes del primer uso de Firestore; sin
 * NEXT_PUBLIC_RECAPTCHA_SITE_KEY queda apagado.
 */
function firebaseApp() {
  if (!isFirebaseConfigured) throw new Error('Firebase no está configurado: completá las variables NEXT_PUBLIC_FIREBASE_* en .env.local')
  app ??= getApps().length ? getApp() : initializeApp(config)
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY
  if (!appCheckReady && siteKey && typeof window !== 'undefined') {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(siteKey), isTokenAutoRefreshEnabled: true })
    appCheckReady = true
  }
  return app
}

export function firebaseAuth() {
  auth ??= getAuth(firebaseApp())
  return auth
}

/** Firestore con caché persistente: la app abre al instante y funciona sin señal (los cambios se sincronizan después). */
export function firestore() {
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
