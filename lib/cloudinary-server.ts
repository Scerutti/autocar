import 'server-only'
import { createHash } from 'node:crypto'

export function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

/** Firma de Cloudinary: sha1 de los parámetros ordenados alfabéticamente + el secret. */
export function signParams(params: Record<string, string | number>, apiSecret: string) {
  const toSign = Object.keys(params)
    .sort()
    .map(k => `${k}=${params[k]}`)
    .join('&')
  return createHash('sha1').update(toSign + apiSecret).digest('hex')
}

/** Carpeta de cada usuario: sólo puede subir y borrar dentro de la suya. */
export const userFolder = (uid: string) => `autocar/${uid}`

/**
 * Cómo terminó un borrado en Cloudinary: `ok` con el `result` que devuelve (`ok` o `not found`, las dos sirven); si
 * no, el status para responder (500 sin configuración, 502 si no se pudo contactar a Cloudinary o lo rechazó) y el
 * mensaje listo para mostrar.
 */
export type DestroyResult = { ok: true; result: string | null } | { ok: false; status: 500 | 502; error: string }

/**
 * Borra una imagen en Cloudinary con una firma del servidor (`image/destroy`, con `invalidate` para sacarla de la CDN).
 * No revisa de quién es: lo revisa quien llama (`isOwnPublicId`). Corta a los 10 s (sin señal, DNS caído).
 */
export async function destroyImage(publicId: string): Promise<DestroyResult> {
  const config = cloudinaryConfig()
  if (!config) return { ok: false, status: 500, error: 'Cloudinary no está configurado' }
  const params = { public_id: publicId, timestamp: Math.floor(Date.now() / 1000), invalidate: 'true' }
  const body = new URLSearchParams({
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    api_key: config.apiKey,
    signature: signParams(params, config.apiSecret),
  })
  let res: Response
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/image/destroy`, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    console.error('Borrado en Cloudinary', publicId, e)
    return { ok: false, status: 502, error: 'No se pudo contactar a Cloudinary' }
  }
  const json = (await res.json().catch(() => ({}))) as { result?: string }
  if (!res.ok) {
    console.error('Cloudinary rechazó el borrado', publicId, res.status, json)
    return { ok: false, status: 502, error: 'Cloudinary rechazó el borrado' }
  }
  return { ok: true, result: json.result ?? null }
}
