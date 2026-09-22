'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CircleHelp, Trash2, TriangleAlert, type LucideIcon } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface ConfirmOptions {
  title: ReactNode
  description?: ReactNode
  /** Resumen de lo que se va a guardar, en filas "Etiqueta: valor", para revisarlo antes de confirmar. */
  details?: { label: string; value: ReactNode }[]
  /** Aviso destacado (p. ej. "son muchos km más que la última vez"). */
  warning?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** danger: acciones que borran. Botón rojo y el foco arranca en "Cancelar". */
  tone?: 'default' | 'danger'
  icon?: LucideIcon
}

type Confirm = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm | null>(null)

/**
 * Un único diálogo de confirmación para toda la app: `if (!(await confirm({...}))) return`.
 * Resuelve true sólo con el botón de confirmar; Cancelar, Escape o abrir otra confirmación dan false.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmOptions | null>(null)
  const [open, setOpen] = useState(false)
  const resolver = useRef<((value: boolean) => void) | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback<Confirm>(options => {
    resolver.current?.(false)
    return new Promise<boolean>(resolve => {
      resolver.current = resolve
      setRequest(options)
      setOpen(true)
    })
  }, [])

  function settle(result: boolean) {
    resolver.current?.(result)
    resolver.current = null
    setOpen(false)
  }

  const danger = request?.tone === 'danger'
  const Icon = request?.icon ?? (danger ? Trash2 : CircleHelp)

  return (
    <ConfirmContext value={confirm}>
      {children}
      <AlertDialog
        open={open}
        onOpenChange={next => !next && settle(false)}
        // El contenido se limpia recién cuando terminó la animación de cierre.
        onOpenChangeComplete={next => !next && setRequest(null)}
      >
        <AlertDialogContent initialFocus={danger ? cancelRef : confirmRef}>
          {request && (
            <>
              <div className="flex items-start gap-4">
                <div
                  className={cn(
                    'flex size-10 shrink-0 items-center justify-center rounded-full',
                    danger ? 'bg-destructive/15 text-destructive' : 'bg-primary/15 text-primary',
                  )}
                >
                  <Icon aria-hidden className="size-5" />
                </div>
                <div className="min-w-0 space-y-1.5 pt-1.5">
                  <AlertDialogTitle>{request.title}</AlertDialogTitle>
                  {request.description && <AlertDialogDescription>{request.description}</AlertDialogDescription>}
                </div>
              </div>

              {request.warning && (
                <p className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-warning">
                  <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                  <span>{request.warning}</span>
                </p>
              )}

              {request.details && request.details.length > 0 && (
                <dl className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-background/40">
                  {request.details.map(d => (
                    <div key={d.label} className="flex items-baseline justify-between gap-4 px-3.5 py-2.5 text-sm">
                      <dt className="shrink-0 text-muted-foreground">{d.label}</dt>
                      <dd className="min-w-0 text-right font-medium">{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <AlertDialogFooter>
                <AlertDialogClose ref={cancelRef} render={<Button variant="outline" className="h-11 sm:min-w-28" />}>
                  {request.cancelLabel ?? 'Cancelar'}
                </AlertDialogClose>
                <Button
                  ref={confirmRef}
                  onClick={() => settle(true)}
                  className={cn('h-11 sm:min-w-28', danger && 'bg-red-600 text-white hover:bg-red-600/90 focus-visible:ring-red-500/40')}
                >
                  {request.confirmLabel ?? 'Sí, confirmar'}
                </Button>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmContext>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  if (!confirm) throw new Error('useConfirm fuera de ConfirmProvider')
  return confirm
}
