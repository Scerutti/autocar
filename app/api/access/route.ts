import { FieldValue } from 'firebase-admin/firestore'
import { accountEmail, accountRef, verifyUser } from '@/lib/firebase/admin'

/**
 * Registro automático: la app está abierta a cualquier cuenta de Google con mail verificado.
 * La primera vez que alguien entra, Firestore rechaza la carga (todavía no está en allowlist) y la
 * app llama acá para registrarlo. Si algún día hay que cerrar la app (invitación o aprobación),
 * alcanza con cambiar esta ruta: las reglas ya exigen el registro.
 */
export async function POST(request: Request) {
  const decoded = await verifyUser(request)
  if (decoded instanceof Response) return decoded
  const email = accountEmail(decoded)
  if (!email) return Response.json({ error: 'Tu cuenta de Google no tiene un mail verificado.' }, { status: 403 })

  try {
    const ref = accountRef(email)
    if (!(await ref.get()).exists) await ref.set({ uid: decoded.uid, createdAt: FieldValue.serverTimestamp() })
  } catch (e) {
    console.error('Registro en allowlist', e)
    return Response.json({ error: 'No pudimos preparar tu cuenta. Probá de nuevo.' }, { status: 500 })
  }
  return Response.json({ ok: true })
}
