import 'server-only'
import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
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

/**
 * Verifica el header "Authorization: Bearer <ID token de Firebase>".
 * Devuelve el token decodificado, o la respuesta 401 para devolver tal cual.
 */
export async function verifyUser(request: Request): Promise<DecodedIdToken | Response> {
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return Response.json({ error: 'No autorizado' }, { status: 401 })
  try {
    return await adminAuth().verifyIdToken(token)
  } catch {
    return Response.json({ error: 'No autorizado' }, { status: 401 })
  }
}

/** Mail con el que la cuenta queda registrada en allowlist; null si Google no lo dio verificado. */
export const accountEmail = (token: DecodedIdToken) => (token.email_verified && token.email ? token.email.toLowerCase() : null)

/** Referencia al registro de una cuenta: allowlist/{mail en minúsculas}, lo mismo que piden las reglas de Firestore. */
export const accountRef = (email: string) => adminDb().collection('allowlist').doc(email)

/**
 * Como verifyUser, y además que la cuenta esté registrada. El registro es automático la primera vez
 * que alguien entra (/api/access). Devuelve el uid, o la respuesta de error para devolver tal cual.
 */
export async function authorize(request: Request): Promise<{ uid: string } | Response> {
  const decoded = await verifyUser(request)
  if (decoded instanceof Response) return decoded
  const email = accountEmail(decoded)
  try {
    if (!email || !(await accountRef(email).get()).exists) {
      return Response.json({ error: 'Tu cuenta todavía no está registrada. Recargá la app.' }, { status: 403 })
    }
  } catch (e) {
    console.error('No se pudo leer la allowlist', e)
    return Response.json({ error: 'No se pudo verificar el acceso' }, { status: 500 })
  }
  return { uid: decoded.uid }
}
