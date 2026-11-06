'use client'

/**
 * Le pide al servidor que termine de borrar un auto ya marcado (`DELETE /api/cars/[carId]`): historial, invitaciones
 * y foto. Va en segundo plano y no avisa si falla: el auto ya desapareció de la app, y el barrido del cron lo termina
 * de borrar una hora después de la marca.
 */
export function purgeCarInBackground(carId: string, getToken: () => Promise<string | null>) {
  void (async () => {
    try {
      const token = await getToken()
      if (!token) return
      const res = await fetch(`/api/cars/${encodeURIComponent(carId)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) console.warn('El servidor no terminó de borrar el auto; lo termina el barrido', carId, res.status)
    } catch (e) {
      console.warn('No se pudo pedir el borrado del auto; lo termina el barrido', carId, e)
    }
  })()
}
