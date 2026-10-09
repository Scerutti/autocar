// Límites de las fotos, compartidos por el navegador (que achica antes de subir) y el servidor (que firma la subida).

/** Lado más largo con el que se guarda una foto, en px. */
export const PHOTO_MAX_SIDE = 1600

/**
 * Máximo del archivo que se elige, antes de achicarlo. Entra cualquier foto de celular (una de 50 MP
 * pesa ~20 MB); lo que se sube después pesa unos cientos de KB.
 */
export const PHOTO_MAX_INPUT_MB = 25

/** Formatos que acepta Cloudinary en la subida firmada (el navegador siempre manda JPG). */
export const PHOTO_UPLOAD_FORMATS = 'jpg,png,webp'

/** Fotos por día que puede subir cada cuenta: la app está abierta a cualquiera y esto acota abusos. */
export const PHOTO_DAILY_LIMIT = 10

export interface PhotoUsage {
  day: string
  photos: number
}

/** Suma una foto al uso del día (arranca de cero cada día); null si ya llegó al máximo. */
export function nextPhotoUsage(prev: Partial<PhotoUsage> | undefined, today: string, limit = PHOTO_DAILY_LIMIT): PhotoUsage | null {
  const used = prev?.day === today && typeof prev.photos === 'number' ? prev.photos : 0
  return used >= limit ? null : { day: today, photos: used + 1 }
}

/** Largo máximo de un public_id de Cloudinary. */
const PUBLIC_ID_MAX_LENGTH = 255

/**
 * true si `publicId` es una imagen dentro de `folder` y no trae nada raro: sólo letras, números, `/`, `_`
 * y `-` (nada de `..`, `//` ni barras invertidas). Sirve para los ids nuevos (uuid) y los viejos (al azar).
 */
export function isOwnPublicId(publicId: unknown, folder: string): publicId is string {
  if (typeof publicId !== 'string' || publicId.length > PUBLIC_ID_MAX_LENGTH) return false
  if (!/^[A-Za-z0-9/_-]+$/.test(publicId) || publicId.includes('//') || publicId.endsWith('/')) return false
  return publicId.startsWith(`${folder}/`)
}
