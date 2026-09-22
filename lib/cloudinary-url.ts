/**
 * Inserta una transformación en una URL de Cloudinary:
 * .../image/upload/v123/x.jpg -> .../image/upload/c_fill,w_800,f_auto,q_auto/v123/x.jpg
 */
export function cloudinaryUrl(url: string, transform: string) {
  if (!url.includes('/image/upload/')) return url
  return url.replace('/image/upload/', `/image/upload/${transform},f_auto,q_auto/`)
}
