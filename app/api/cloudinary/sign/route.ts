import { adminDb, authorize } from '@/lib/firebase/admin'
import { cloudinaryConfig, signParams, userFolder } from '@/lib/cloudinary-server'
import { todayInTimeZone } from '@/lib/dates'
import { nextPhotoUsage, PHOTO_DAILY_LIMIT, PHOTO_MAX_SIDE, PHOTO_UPLOAD_FORMATS } from '@/lib/photo-limits'
import { DEFAULT_SETTINGS } from '@/lib/types'

/** Cuenta una foto más del día; false si la cuenta ya llegó al máximo. */
async function takePhotoQuota(uid: string) {
  // usage/{uid} está fuera de users/{uid}: las reglas no dejan que el usuario lo toque.
  const db = adminDb()
  const ref = db.collection('usage').doc(uid)
  const today = todayInTimeZone(DEFAULT_SETTINGS.timezone)
  return db.runTransaction(async tx => {
    const next = nextPhotoUsage((await tx.get(ref)).data(), today)
    if (next) tx.set(ref, next, { merge: true })
    return next != null
  })
}

/**
 * Devuelve una firma para que el navegador suba la foto directo a Cloudinary sin exponer el secret.
 * Lo firmado no se puede cambiar desde el navegador: la carpeta del usuario, los formatos permitidos y
 * un achique al guardar (por si alguien saltea el que hace el navegador). La firma vence a la hora.
 */
export async function POST(request: Request) {
  const auth = await authorize(request)
  if (auth instanceof Response) return auth
  const { uid } = auth
  const config = cloudinaryConfig()
  if (!config) return Response.json({ error: 'Cloudinary no está configurado' }, { status: 500 })

  try {
    if (!(await takePhotoQuota(uid))) {
      return Response.json({ error: `Llegaste al máximo de ${PHOTO_DAILY_LIMIT} fotos por día. Probá de nuevo mañana.` }, { status: 429 })
    }
  } catch (e) {
    console.error('Límite de fotos', e)
    return Response.json({ error: 'No se pudo preparar la subida de la foto' }, { status: 500 })
  }

  const params = {
    folder: userFolder(uid),
    allowed_formats: PHOTO_UPLOAD_FORMATS,
    transformation: `c_limit,w_${PHOTO_MAX_SIDE},h_${PHOTO_MAX_SIDE}`,
    timestamp: Math.floor(Date.now() / 1000),
  }
  return Response.json({
    params,
    signature: signParams(params, config.apiSecret),
    apiKey: config.apiKey,
    cloudName: config.cloudName,
  })
}
