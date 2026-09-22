import { uidFromRequest } from '@/lib/firebase/admin'
import { cloudinaryConfig, signParams, userFolder } from '@/lib/cloudinary-server'

// Devuelve una firma para que el navegador suba la foto directo a Cloudinary sin exponer el secret.
export async function POST(request: Request) {
  const uid = await uidFromRequest(request)
  if (!uid) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const config = cloudinaryConfig()
  if (!config) return Response.json({ error: 'Cloudinary no está configurado' }, { status: 500 })

  const params = { folder: userFolder(uid), timestamp: Math.floor(Date.now() / 1000) }
  return Response.json({
    ...params,
    signature: signParams(params, config.apiSecret),
    apiKey: config.apiKey,
    cloudName: config.cloudName,
  })
}
