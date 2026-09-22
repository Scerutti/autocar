import { uidFromRequest } from '@/lib/firebase/admin'
import { cloudinaryConfig, signParams, userFolder } from '@/lib/cloudinary-server'

export async function POST(request: Request) {
  const uid = await uidFromRequest(request)
  if (!uid) return Response.json({ error: 'No autorizado' }, { status: 401 })
  const config = cloudinaryConfig()
  if (!config) return Response.json({ error: 'Cloudinary no está configurado' }, { status: 500 })

  const { publicId } = (await request.json().catch(() => ({}))) as { publicId?: string }
  if (typeof publicId !== 'string' || !publicId.startsWith(`${userFolder(uid)}/`)) {
    return Response.json({ error: 'Imagen inválida' }, { status: 400 })
  }

  const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), invalidate: 'true' }
  const body = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    api_key: config.apiKey,
    signature: signParams(params, config.apiSecret),
  })
  const res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`, { method: 'POST', body })
  const json = (await res.json().catch(() => ({}))) as { result?: string }
  if (!res.ok) return Response.json({ error: 'Cloudinary rechazó el borrado' }, { status: 502 })
  return Response.json({ result: json.result })
}
