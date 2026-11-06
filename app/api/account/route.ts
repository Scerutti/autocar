import { deleteAccount } from '@/lib/account-server'
import { accountEmail, verifyUser } from '@/lib/firebase/admin'

export const maxDuration = 60

/**
 * Borra la cuenta de quien llama con todos sus datos (`deleteAccount`, `lib/account-server.ts`). Pide el token y el
 * mail verificado como `authorize`, pero no el registro en `allowlist`: el borrado lo saca antes de borrar la cuenta
 * de Firebase Auth, y una llamada que se cortó entre esos dos pasos se tiene que poder repetir. Respuestas: 200
 * `{ deleted: true }` (también si ya estaba borrada); 409 `{ error, cars }` si tiene autos propios con miembros (no
 * borra nada); 502 si Cloudinary falló (la cuenta de Auth y el registro siguen: reintentar); 500 si falló otra cosa (reintentar: cada paso
 * tolera que ya esté hecho).
 */
export async function DELETE(request: Request) {
  const decoded = await verifyUser(request)
  if (decoded instanceof Response) return decoded
  const email = accountEmail(decoded)
  if (!email) return Response.json({ error: 'Tu cuenta de Google no tiene un mail verificado.' }, { status: 403 })

  try {
    const result = await deleteAccount(decoded.uid, email)
    if (result.status === 'blocked') {
      return Response.json(
        { error: 'Tenés autos compartidos. Antes de borrar la cuenta, pasáselos a otra persona, sacá a los miembros o borralos.', cars: result.cars },
        { status: 409 },
      )
    }
    if (result.status === 'photos-pending') {
      return Response.json({ error: 'No pudimos borrar tus fotos, así que la cuenta no se terminó de borrar. Probá de nuevo en un rato.' }, { status: 502 })
    }
    return Response.json({ deleted: true })
  } catch (e) {
    console.error('Borrado de cuenta', decoded.uid, e)
    return Response.json({ error: 'No se pudo terminar de borrar la cuenta. Probá de nuevo.' }, { status: 500 })
  }
}
