'use client'

import { useState, type ReactNode } from 'react'
import { errorMessage, toast } from './toast'
import { addOutboxEntry, failOutboxEntry, readOutbox, removeOutboxEntry, setWaiting, type OutboxEntry } from './outbox'

/** Cuánto se espera la confirmación del servidor antes de seguir como "sin conexión". */
export const OFFLINE_GRACE_MS = 2500
const OFFLINE_NOTE = 'Sin conexión: se sincroniza cuando vuelva la señal.'

/** `unchanged`: al editar no había nada distinto y no se escribió nada (`WriteOutcome` de lib/db.ts). */
export type SaveStatus = 'saved' | 'offline' | 'unchanged'

/** Para seguir una escritura en la bandeja de lo que no se sincronizó (`lib/outbox.ts`): la cuenta y la entrada. */
export interface OutboxTrack {
  uid: string
  entry: OutboxEntry
}

/**
 * Firestore guarda primero en la caché local y la promesa recién resuelve cuando el servidor confirma.
 * Sin señal (p. ej. en la estación de servicio) eso puede tardar: después de un momento seguimos
 * como 'offline' y el cambio se sincroniza solo. Si el servidor lo rechaza más tarde, avisamos con un toast
 * `errorTitle` y el motivo (`errorMessage`: por ejemplo, que el registro se borró en otro dispositivo). Si la
 * escritura resuelve `'unchanged'` (`WriteOutcome`), no se escribió nada y devuelve `unchanged`.
 * Con `track` (en vez de `errorTitle`, que queda "No se pudo guardar"), la escritura va a la bandeja antes de esperar:
 * - Si el servidor confirma, la entrada se borra.
 * - Si rechaza después del momento de espera, la entrada pasa a `failed` con el motivo y el toast dice que quedó en
 *   Pendientes. Si rechaza antes, el error lo muestra el formulario, que sigue abierto con los datos: la entrada se
 *   borra, salvo que ya estuviera en la bandeja (un reintento o un borrador), que queda `failed`.
 * - Si la app se cierra antes de saberlo, la entrada queda `pending` y la resuelve `OutboxSync` al volver a abrirla.
 */
export async function settle(p: Promise<unknown>, track: string | OutboxTrack = 'No se pudo guardar'): Promise<SaveStatus> {
  const errorTitle = typeof track === 'string' ? track : 'No se pudo guardar'
  const outbox = typeof track === 'string' ? null : track
  let late = false
  if (outbox) {
    const { uid, entry } = outbox
    const known = readOutbox(uid).some(e => e.id === entry.id)
    addOutboxEntry(uid, entry)
    setWaiting(entry.id, true)
    p.then(
      () => removeOutboxEntry(uid, entry.id),
      e => (late || known ? failOutboxEntry(uid, entry.id, errorMessage(e)) : removeOutboxEntry(uid, entry.id)),
    ).finally(() => setWaiting(entry.id, false))
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const status = await Promise.race([
    p.then(v => (v === 'unchanged' ? ('unchanged' as const) : ('saved' as const))),
    new Promise<'offline'>(resolve => {
      timer = setTimeout(() => {
        late = true
        resolve('offline')
      }, OFFLINE_GRACE_MS)
    }),
  ])
  clearTimeout(timer)
  if (status === 'offline') {
    p.catch(e =>
      toast.error(errorTitle, {
        description: outbox ? `${errorMessage(e)} Quedó en Pendientes (la campanita) para que lo reintentes.` : errorMessage(e),
      }),
    )
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
