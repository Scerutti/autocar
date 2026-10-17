'use client'

import type { LucideIcon } from 'lucide-react'
import { useLocalValue, writeLocal } from '@/lib/local-store'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'

const hiddenKey = (id: string) => `autocar:aviso-oculto:${id}`

/**
 * Consejo que el usuario puede ocultar para siempre en este dispositivo (p. ej. cómo instalar la app). Se
 * oculta sin confirmación porque se puede deshacer desde el toast. No aparece hasta saber si estaba oculto,
 * para que no parpadee.
 */
export function DismissibleHint({
  id,
  icon: Icon,
  children,
  className,
}: {
  /** Identifica el aviso: si cambia, el aviso vuelve a aparecer para todos. */
  id: string
  icon: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  const hidden = useLocalValue(hiddenKey(id))
  if (hidden !== null) return null

  function hide() {
    writeLocal(hiddenKey(id), '1')
    toast.info('Aviso oculto', {
      id: `hint-${id}`,
      description: 'No lo vas a ver más en este dispositivo.',
      action: { label: 'Deshacer', onClick: () => writeLocal(hiddenKey(id), null) },
    })
  }

  return (
    <div className={cn('flex gap-3 rounded-xl border border-warning/20 bg-warning/5 p-4 text-sm', className)}>
      <Icon aria-hidden className="size-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        {children}
        <button
          type="button"
          onClick={hide}
          className="mt-3 rounded-md text-xs font-medium text-muted-foreground underline-offset-4 outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          No mostrar más
        </button>
      </div>
    </div>
  )
}
