import 'server-only'
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

function adminApp() {
  if (getApps().length) return getApp()
  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL
  // En Vercel la clave suele quedar con "\n" literales.
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (clientEmail && privateKey) {
    return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId })
  }
  // Sin service account alcanza para verificar ID tokens, pero no para leer Firestore.
  return initializeApp({ projectId })
}

export const adminAuth = () => getAuth(adminApp())
export const adminDb = () => getFirestore(adminApp())

/** Verifica el header "Authorization: Bearer <idToken>" y devuelve el uid, o null. */
export async function uidFromRequest(request: Request): Promise<string | null> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return null
  try {
    const decoded = await adminAuth().verifyIdToken(token)
    return decoded.uid
  } catch {
    return null
  }
}
