import { uidFromRequest } from '@/lib/firebase/admin'
import { sendToUser } from '@/lib/push-server'

export async function POST(request: Request) {
  const uid = await uidFromRequest(request)
  if (!uid) return Response.json({ error: 'No autorizado' }, { status: 401 })
  try {
    const { sent } = await sendToUser(uid, [
      { title: 'AutoCar', body: '¡Las notificaciones funcionan! 🚗', url: '/ajustes', tag: 'test' },
    ])
    return Response.json({ sent })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
