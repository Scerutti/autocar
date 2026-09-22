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
