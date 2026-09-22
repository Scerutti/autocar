'use client'

import { Toast } from '@base-ui/react/toast'
import { CircleAlert, CircleCheck, Info, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { toastManager, type ToastType } from '@/lib/toast'

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CircleCheck className="text-success" />,
  error: <CircleAlert className="text-destructive" />,
  warning: <TriangleAlert className="text-warning" />,
  info: <Info className="text-primary" />,
  loading: <LoaderCircle className="animate-spin text-muted-foreground" />,
}

/** Se monta una sola vez en la raíz. F6 lleva el foco a los toasts. */
export function Toaster() {
  return (
    <Toast.Provider toastManager={toastManager} limit={3}>
      <Toast.Portal>
        <Toast.Viewport className="toast-viewport">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  )
}

function ToastList() {
  const { toasts } = Toast.useToastManager()
  return toasts.map(t => (
    <Toast.Root
      key={t.id}
      toast={t}
      className="toast-root rounded-xl border border-white/10 bg-popover text-popover-foreground shadow-2xl shadow-black/50 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Toast.Content className="toast-content flex items-start gap-3 overflow-hidden py-3 pl-3.5 pr-2">
        <span aria-hidden className="mt-px shrink-0 [&_svg]:size-5">
          {ICONS[(t.type as ToastType) ?? 'info'] ?? ICONS.info}
        </span>
        <div className="min-w-0 flex-1 py-px">
          <Toast.Title className="text-sm font-medium leading-5" />
          <Toast.Description className="mt-0.5 text-sm leading-5 text-muted-foreground" />
        </div>
        <Toast.Action className="-my-0.5 shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-primary outline-none transition hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring" />
        <Toast.Close
          aria-label="Cerrar notificación"
          className="-my-0.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" />
        </Toast.Close>
      </Toast.Content>
    </Toast.Root>
  ))
}
