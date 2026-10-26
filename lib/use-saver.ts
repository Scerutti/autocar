'use client'

import { useState, type ReactNode } from 'react'
import { errorMessage, toast } from './toast'

const OFFLINE_GRACE_MS = 2500
const OFFLINE_NOTE = 'Sin conexión: se sincroniza cuando vuelva la señal.'

/** `unchanged`: al editar no había nada distinto y no se escribió nada (`WriteOutcome` de lib/db.ts). */
export type SaveStatus = 'saved' | 'offline' | 'unchanged'

/**
 * Firestore guarda primero en la caché local y la promesa recién resuelve cuando el servidor confirma.
 * Sin señal (p. ej. en la estación de servicio) eso puede tardar: después de un momento seguimos
 * como 'offline' y el cambio se sincroniza solo. Si el servidor lo rechaza más tarde, avisamos con un toast
 * `errorTitle` y el motivo (`errorMessage`: por ejemplo, que el registro se borró en otro dispositivo). Si la
 * escritura resuelve `'unchanged'` (`WriteOutcome`), no se escribió nada y devuelve `unchanged`.
 */
export async function settle(p: Promise<unknown>, errorTitle = 'No se pudo guardar'): Promise<SaveStatus> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const status = await Promise.race([
    p.then(v => (v === 'unchanged' ? ('unchanged' as const) : ('saved' as const))),
    new Promise<'offline'>(resolve => {
      timer = setTimeout(() => resolve('offline'), OFFLINE_GRACE_MS)
    }),
  ])
  clearTimeout(timer)
  if (status === 'offline') {
    p.catch(e => toast.error(errorTitle, { description: errorMessage(e) }))
  }
  return status
}

/** Toast de "guardado", aclarando si quedó pendiente de sincronizar. Si no había cambios, dice "Sin cambios". */
export function toastSaved(title: string, status: SaveStatus, description?: ReactNode) {
  if (status === 'unchanged') toast.info('Sin cambios')
  else toast.success(title, { description: status === 'offline' ? OFFLINE_NOTE : description })
}

/**
 * Borrado con "Deshacer": se borra en el momento y el toast ofrece volver atrás.
 * Es mejor práctica que pedir confirmación para acciones frecuentes y reversibles.
 */
export function removeWithUndo({
  message,
  remove,
  restore,
}: {
  message: string
  remove: () => Promise<unknown>
  restore: () => Promise<unknown>
}) {
  remove().catch(e => toast.error('No se pudo borrar', { description: errorMessage(e) }))
  toast.success(message, {
    action: {
      label: 'Deshacer',
      onClick: () => {
        restore().catch(e => toast.error('No se pudo restaurar', { description: errorMessage(e) }))
        toast.info('Listo, lo recuperamos')
      },
    },
  })
}

/** Para tareas que siguen después de navegar: si fallan, avisa con un toast. */
export function runInBackground(p: Promise<unknown>, errorTitle: string) {
  p.catch(e => toast.error(errorTitle, { description: errorMessage(e) }))
}

/**
 * Estado de un formulario que guarda: "guardando…" y error para mostrar junto al botón. Si el registro se borró en
 * otro dispositivo (`not-found`), avisa con un toast en vez del error: la pantalla del registro pasa a "no existe"
 * cuando llega el borrado, y el error junto al botón no se vería.
 */
export function useSaver() {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>) {
    setSaving(true)
    setError(null)
    try {
      await fn()
      return true
    } catch (e) {
      if ((e as { code?: string })?.code === 'not-found') toast.error('No se pudo guardar', { description: errorMessage(e) })
      else setError(errorMessage(e))
      return false
    } finally {
      setSaving(false)
    }
  }

  return { saving, error, setError, run }
}
