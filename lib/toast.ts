import { Toast } from '@base-ui/react/toast'
import type { ReactNode } from 'react'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

/**
 * Manager global de toasts: permite mostrarlos desde cualquier lado (también desde funciones
 * fuera de React) y los dibuja el <Toaster /> montado una sola vez en la raíz.
 */
export const toastManager = Toast.createToastManager()

export interface ToastOptions {
  description?: ReactNode
  /** Botón de acción, p. ej. "Deshacer". Al tocarlo se cierra el toast. */
  action?: { label: string; onClick: () => void }
  /** Milisegundos hasta que se cierra solo; 0 = no se cierra solo. */
  timeout?: number
  /** Si ya hay un toast con este id se actualiza en lugar de apilar otro (evita duplicados). */
  id?: string
}

const DEFAULT_TIMEOUT: Record<ToastType, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
  loading: 0,
}

function show(type: ToastType, title: ReactNode, { action, description, timeout, id }: ToastOptions = {}) {
  const toastId: string = toastManager.add({
    id,
    type,
    title,
    description,
    // Los errores se anuncian de inmediato a los lectores de pantalla; el resto, sin interrumpir.
    priority: type === 'error' ? 'high' : 'low',
    // Con acción damos más tiempo para alcanzar a tocarla.
    timeout: timeout ?? (action ? Math.max(8000, DEFAULT_TIMEOUT[type]) : DEFAULT_TIMEOUT[type]),
    actionProps: action
      ? {
          children: action.label,
          onClick: () => {
            toastManager.close(toastId)
            action.onClick()
          },
        }
      : undefined,
  })
  return toastId
}

export const toast = {
  success: (title: ReactNode, options?: ToastOptions) => show('success', title, options),
  error: (title: ReactNode, options?: ToastOptions) => show('error', title, options),
  warning: (title: ReactNode, options?: ToastOptions) => show('warning', title, options),
  info: (title: ReactNode, options?: ToastOptions) => show('info', title, options),
  loading: (title: ReactNode, options?: ToastOptions) => show('loading', title, options),
  dismiss: (id?: string) => toastManager.close(id),
}

/** Mensaje legible de un error desconocido. */
export function errorMessage(e: unknown) {
  const code = (e as { code?: string })?.code
  if (code === 'permission-denied') return 'No tenés permiso para hacer esto. Probá cerrar sesión y volver a entrar.'
  if (code === 'unavailable') return 'No hay conexión con el servidor.'
  return (e as Error)?.message || 'Ocurrió un error inesperado.'
}
