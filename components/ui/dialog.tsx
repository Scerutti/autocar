'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

// Base UI se encarga de lo difícil: foco atrapado y devuelto al cerrar, Escape, clic afuera,
// bloqueo del scroll de fondo y atributos ARIA (role="dialog", aria-labelledby/-describedby).

const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogContent({
  className,
  children,
  showClose = true,
  ...props
}: DialogPrimitive.Popup.Props & { showClose?: boolean }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none"
      />
      <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
        <DialogPrimitive.Popup
          data-slot="dialog-content"
          className={cn(
            // Mobile: hoja que sube desde abajo. Desktop: tarjeta centrada.
            'relative flex max-h-[calc(100dvh-2rem)] w-full max-w-md flex-col gap-4 overflow-y-auto rounded-t-2xl border border-white/10 bg-popover p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-popover-foreground shadow-2xl shadow-black/50 outline-none',
            'transition-[translate,scale,opacity] duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-starting-style:translate-y-full data-ending-style:translate-y-full motion-reduce:transition-none',
            'sm:rounded-2xl sm:pb-5 sm:data-starting-style:translate-y-0 sm:data-starting-style:scale-95 sm:data-starting-style:opacity-0 sm:data-ending-style:translate-y-0 sm:data-ending-style:scale-95 sm:data-ending-style:opacity-0',
            className,
          )}
          {...props}
        >
          {children}
          {showClose && (
            <DialogPrimitive.Close
              aria-label="Cerrar"
              className="absolute right-3 top-3 flex size-8 items-center justify-center rounded-lg text-muted-foreground outline-none transition hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          )}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Viewport>
    </DialogPrimitive.Portal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1 pr-8', className)} {...props} />
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-footer" className={cn('flex gap-3', className)} {...props} />
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg font-semibold tracking-tight', className)} {...props} />
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />
  )
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger }
