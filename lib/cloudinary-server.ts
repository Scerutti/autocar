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

/** Páginas de `deleteImagesByPrefix`: cada llamada a Cloudinary borra hasta 1000 fotos. */
const PREFIX_DELETE_PAGES = 10

/** Cómo terminó un borrado por carpeta: `ok` con cuántas fotos borró, o el mensaje del fallo (para los logs). */
export type PrefixDeleteResult = { ok: true; deleted: number } | { ok: false; error: string }

/**
 * Borra todas las fotos cuyo `public_id` empieza con `prefix` (por ejemplo `autocar/{uid}/`, `accountImagePrefix`) con
 * la Admin API de Cloudinary (`DELETE resources/image/upload?prefix=…`, autenticación básica con la api key y el
 * secret; sólo desde el servidor, no pasa por la CSP). Cloudinary borra hasta 1000 por llamada y avisa con `partial`
 * (y `next_cursor`) si quedan más: sigue hasta `PREFIX_DELETE_PAGES` llamadas. Una carpeta vacía o inexistente (404)
 * cuenta como borrada, así se puede llamar de nuevo. Corta cada llamada a los 10 s.
 */
export async function deleteImagesByPrefix(prefix: string): Promise<PrefixDeleteResult> {
  const config = cloudinaryConfig()
  if (!config) return { ok: false, error: 'Cloudinary no está configurado' }
  const authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`
  let cursor: string | null = null
  let deleted = 0
  for (let page = 0; page < PREFIX_DELETE_PAGES; page++) {
    const query = new URLSearchParams({ prefix, invalidate: 'true' })
    if (cursor) query.set('next_cursor', cursor)
    let res: Response
    try {
      res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/upload?${query}`, {
        method: 'DELETE',
        headers: { Authorization: authorization },
        signal: AbortSignal.timeout(10_000),
      })
    } catch (e) {
      console.error('Borrado por carpeta en Cloudinary', prefix, e)
      return { ok: false, error: 'No se pudo contactar a Cloudinary' }
    }
    if (res.status === 404) return { ok: true, deleted }
    const json = (await res.json().catch(() => ({}))) as { deleted?: Record<string, string>; partial?: boolean; next_cursor?: string }
    if (!res.ok) {
      console.error('Cloudinary rechazó el borrado por carpeta', prefix, res.status, json)
      return { ok: false, error: 'Cloudinary rechazó el borrado' }
    }
    deleted += Object.values(json.deleted ?? {}).filter(v => v === 'deleted').length
    if (!json.partial && !json.next_cursor) return { ok: true, deleted }
    cursor = json.next_cursor ?? null
  }
  return { ok: false, error: 'Quedaron fotos sin borrar en Cloudinary' }
}
