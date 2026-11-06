import { authorize } from '@/lib/firebase/admin'
import { cloudinaryConfig, destroyImage, userFolder } from '@/lib/cloudinary-server'
import { isOwnPublicId } from '@/lib/photo-limits'

/**
 * Borra una foto del usuario en Cloudinary (`destroyImage`). Sólo acepta imágenes de su carpeta, y sin caracteres que
 * puedan escaparse de ella. Si no se puede contactar a Cloudinary (sin señal, DNS caído o más de 10 s) responde 502.
 */
export async function POST(request: Request) {
  const auth = await authorize(request)
  if (auth instanceof Response) return auth
  const { uid } = auth
  if (!cloudinaryConfig()) return Response.json({ error: 'Cloudinary no está configurado' }, { status: 500 })

  const { publicId } = (await request.json().catch(() => ({}))) as { publicId?: unknown }
  if (!isOwnPublicId(publicId, userFolder(uid))) {
    return Response.json({ error: 'Imagen inválida' }, { status: 400 })
  }

  const destroyed = await destroyImage(publicId)
  if (!destroyed.ok) return Response.json({ error: destroyed.error }, { status: destroyed.status })
  return Response.json({ result: destroyed.result })
}
