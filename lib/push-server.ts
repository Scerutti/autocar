import 'server-only'
import webpush from 'web-push'
import { adminDb } from './firebase/admin'
import type { PushPayload } from './notifications'

let configured = false

function configure() {
  if (configured) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) throw new Error('Faltan las claves VAPID')
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.com', publicKey, privateKey)
  configured = true
}

/** Envía los mensajes a todos los dispositivos del usuario y borra las suscripciones vencidas. */
export async function sendToUser(uid: string, messages: PushPayload[]) {
  if (!messages.length) return { sent: 0, devices: 0 }
  configure()
  const subsRef = adminDb().collection('users').doc(uid).collection('pushSubscriptions')
  const subs = await subsRef.get()
  let sent = 0
  await Promise.all(
    subs.docs.map(async d => {
      const { endpoint, keys } = d.data() as { endpoint: string; keys: { p256dh: string; auth: string } }
      for (const msg of messages) {
        try {
          await webpush.sendNotification({ endpoint, keys }, JSON.stringify(msg), { TTL: 60 * 60 * 24 })
          sent++
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          // 404/410: el navegador dio de baja la suscripción.
          if (status === 404 || status === 410) {
            await d.ref.delete()
            return
          }
          console.error('Error enviando push', status, (e as Error).message)
        }
      }
    }),
  )
  return { sent, devices: subs.size }
}
