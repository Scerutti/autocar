import 'server-only'
import { createHash } from 'node:crypto'
import { chunks } from './account'

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

/** Páginas de `listImagesByPrefix` (de hasta 500 fotos cada una). */
const LIST_PAGES = 20

/** `public_ids` por llamada de `deleteImagesByIds`: el máximo de la Admin API. */
const DELETE_BATCH = 100

/** Resultado de una operación de la Admin API: el valor, o el mensaje del fallo (para los logs). */
export type AdminResult<T> = { ok: true; value: T } | { ok: false; error: string }

/**
 * Llama a la Admin API de Cloudinary (`resources/image/upload`, autenticación básica con la api key y el secret; sólo
 * desde el servidor, no pasa por la CSP). Corta a los 10 s. Un 404 (carpeta o fotos que no existen) da `null`.
 */
async function adminCall(method: 'GET' | 'DELETE', query: URLSearchParams): Promise<AdminResult<Record<string, unknown> | null>> {
  const config = cloudinaryConfig()
  if (!config) return { ok: false, error: 'Cloudinary no está configurado' }
  const authorization = `Basic ${Buffer.from(`${config.apiKey}:${config.apiSecret}`).toString('base64')}`
  let res: Response
  try {
    res = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/resources/image/upload?${query}`, {
      method,
      headers: { Authorization: authorization },
      signal: AbortSignal.timeout(10_000),
    })
  } catch (e) {
    console.error('Admin API de Cloudinary', method, e)
    return { ok: false, error: 'No se pudo contactar a Cloudinary' }
  }
  if (res.status === 404) return { ok: true, value: null }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    console.error('Cloudinary rechazó el pedido', method, res.status, json)
    return { ok: false, error: `Cloudinary rechazó el pedido (${res.status})` }
  }
  return { ok: true, value: json }
}

/**
 * Los `public_id` de todas las fotos que empiezan con `prefix` (por ejemplo `autocar/{uid}/`), de a 500 por página
 * con `next_cursor`, hasta `LIST_PAGES` páginas (si quedan más, falla: mejor no borrar a medias sin saberlo). Una
 * carpeta vacía o inexistente da una lista vacía.
 */
export async function listImagesByPrefix(prefix: string): Promise<AdminResult<string[]>> {
  const ids: string[] = []
  let cursor: string | null = null
  for (let page = 0; page < LIST_PAGES; page++) {
    const query = new URLSearchParams({ prefix, max_results: '500' })
    if (cursor) query.set('next_cursor', cursor)
    const res = await adminCall('GET', query)
    if (!res.ok) return res
    const value = res.value ?? {}
    const resources = Array.isArray(value.resources) ? (value.resources as { public_id?: unknown }[]) : []
    for (const r of resources) if (r && typeof r.public_id === 'string') ids.push(r.public_id)
    cursor = typeof value.next_cursor === 'string' ? value.next_cursor : null
    if (!cursor) return { ok: true, value: ids }
  }
  return { ok: false, error: 'La carpeta tiene demasiadas fotos para listarlas' }
}

/**
 * Borra esas fotos por `public_id` (`DELETE resources/image/upload?public_ids[]=…`, con `invalidate` para sacarlas de la
 * CDN), de a `DELETE_BATCH`. Si Cloudinary contesta `partial` (quedaron versiones derivadas), repite esa parte una vez.
 * Las que ya no existen cuentan como borradas. Devuelve cuántas borró.
 */
export async function deleteImagesByIds(publicIds: string[]): Promise<AdminResult<number>> {
  let deleted = 0
  for (const part of chunks(publicIds, DELETE_BATCH)) {
    const query = new URLSearchParams({ invalidate: 'true' })
    part.forEach(id => query.append('public_ids[]', id))
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await adminCall('DELETE', query)
      if (!res.ok) return res
      const value = res.value ?? {}
      const result = (value.deleted && typeof value.deleted === 'object' ? value.deleted : {}) as Record<string, unknown>
      deleted += Object.values(result).filter(v => v === 'deleted').length
      if (value.partial !== true) break
      if (attempt === 1) return { ok: false, error: 'Cloudinary no terminó de borrar las fotos' }
    }
  }
  return { ok: true, value: deleted }
}
