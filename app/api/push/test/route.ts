import { authorize } from '@/lib/firebase/admin'
import { sendToUser } from '@/lib/push-server'

export async function POST(request: Request) {
  const auth = await authorize(request)
  if (auth instanceof Response) return auth
  const { uid } = auth
  try {
    const { sent } = await sendToUser(uid, [
      { title: 'AutoCar', body: '¡Las notificaciones funcionan! 🚗', url: '/ajustes', tag: 'test' },
    ])
    return Response.json({ sent })
  } catch (e) {
    // El detalle queda en los logs del servidor; al navegador no le mandamos errores internos.
    console.error('Push de prueba', e)
    return Response.json({ error: 'No se pudo enviar la notificación de prueba' }, { status: 500 })
  }
}
