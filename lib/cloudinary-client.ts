'use client'

const MAX_SIDE = 1600

/** Achica la foto en el navegador antes de subirla (las del celular pesan 5-10 MB). */
export async function resizeImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null)
  if (!bitmap) return file
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise(resolve => canvas.toBlob(b => resolve(b ?? file), 'image/jpeg', 0.85))
}

export async function uploadImage(file: File, idToken: string): Promise<{ url: string; publicId: string }> {
  const signRes = await fetch('/api/cloudinary/sign', { method: 'POST', headers: { Authorization: `Bearer ${idToken}` } })
  const sign = await signRes.json()
  if (!signRes.ok) throw new Error(sign.error ?? 'No se pudo preparar la subida de la foto')

  const form = new FormData()
  form.append('file', await resizeImage(file))
  form.append('api_key', sign.apiKey)
  form.append('timestamp', String(sign.timestamp))
  form.append('folder', sign.folder)
  form.append('signature', sign.signature)
  const res = await fetch(`https://api.cloudinary.com/v1_1/${sign.cloudName}/image/upload`, { method: 'POST', body: form })
  const json = await res.json()
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
