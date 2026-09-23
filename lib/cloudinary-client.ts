'use client'

import { PHOTO_MAX_INPUT_MB, PHOTO_MAX_SIDE } from './photo-limits'

/** Error con un mensaje para mostrarle al usuario tal cual. */
export class PhotoError extends Error {}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('es-AR', { maximumFractionDigits: 1 })} MB`

/**
 * Revisa la foto y la achica en el navegador antes de subirla: las del celular pesan 3-10 MB y quedan
 * en unos cientos de KB (JPG de hasta 1600 px). Si no sirve, tira PhotoError con el motivo.
 */
export async function preparePhoto(file: File): Promise<Blob> {
  // Algunas fotos (p. ej. HEIC en Windows) llegan sin tipo: en ese caso decide si se puede abrir.
  if (file.type && !file.type.startsWith('image/')) throw new PhotoError('El archivo tiene que ser una foto.')
  if (file.size > PHOTO_MAX_INPUT_MB * 1024 * 1024) {
    throw new PhotoError(`La foto pesa ${mb(file.size)} y el máximo es ${PHOTO_MAX_INPUT_MB} MB. Probá con otra.`)
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap) throw new PhotoError('No pudimos abrir esta foto. Probá con otra, en JPG o PNG.')

  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  if (!blob) throw new PhotoError('No pudimos procesar esta foto. Probá con otra.')
  return blob
}

/** Sube una foto ya preparada con `preparePhoto`, con los parámetros que firma el servidor. */
export async function uploadImage(photo: Blob, idToken: string): Promise<{ url: string; publicId: string }> {
  const signRes = await fetch('/api/cloudinary/sign', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } })
  const sign = await signRes.json().catch(() => ({}))
  if (!signRes.ok) throw new Error(sign.error ?? 'No se pudo preparar la subida de la foto')

  const form = new FormData()
  form.append('file', photo)
  for (const [key, value] of Object.entries(sign.params as Record<string, string | number>)) form.append(key, String(value))
  form.append('api_key', sign.apiKey)
  form.append('signature', sign.signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, { method: 'POST', body: form })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error?.message ?? 'No se pudo subir la foto')
  return { url: json.secure_url, publicId: json.public_id }
}

/** Borra una imagen vieja; si falla no es grave (queda huérfana en Cloudinary). */
export async function deleteImage(publicId: string, idToken: string) {
  try {
    await fetch('/api/cloudinary/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publicId }),
    })
  } catch (e) {
    console.warn('No se pudo borrar la imagen anterior', e)
  }
}
