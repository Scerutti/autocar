'use client'

import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
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

function firebaseApp() {
  if (!isFirebaseConfigured) throw new Error('Firebase no está configurado: completá las variables NEXT_PUBLIC_FIREBASE_* en .env.local')
  app ??= getApps().length ? getApp() : initializeApp(config)
  return app
}

export function firebaseAuth() {
  auth ??= getAuth(firebaseApp())
  return auth
}

export function firestore() {
  if (!db) {
    try {
      // Caché persistente: la app abre al instante y funciona sin señal (los cambios se sincronizan después).
      db = initializeFirestore(firebaseApp(), {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      })
    } catch {
      db = getFirestore(firebaseApp())
    }
  }
  return db
}
