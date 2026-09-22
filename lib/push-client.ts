'use client'

import { deletePushSubscription, savePushSubscription } from './db'

export type PushSupport = 'supported' | 'unsupported' | 'needs-install'

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported'
  // En iPhone sólo hay push si la app está agregada a la pantalla de inicio.
  if (isIOS() && !isStandalone()) return 'needs-install'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'supported'
}

export async function registerServiceWorker() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
  } catch (e) {
    console.error('No se pudo registrar el service worker', e)
    return null
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

export async function currentSubscription() {
  if (pushSupport() !== 'supported') return null
  const reg = await navigator.serviceWorker.ready
  return reg.pushManager.getSubscription()
}

/** Pide permiso (tiene que llamarse desde un click), suscribe este dispositivo y lo guarda en Firestore. */
export async function enablePush(uid: string) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('No diste permiso para notificaciones. Podés habilitarlo desde la configuración del navegador.')
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  if (!key) throw new Error('Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY')
  const reg = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)
  await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }))
  await savePushSubscription(uid, sub.toJSON())
  return sub
}

export async function disablePush(uid: string) {
  const sub = await currentSubscription()
  if (!sub) return
  await deletePushSubscription(uid, sub.endpoint)
  await sub.unsubscribe()
}
