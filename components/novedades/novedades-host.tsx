'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Sparkles } from 'lucide-react'
import { useData } from '@/components/providers/data-provider'
import { Button, buttonVariants } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { pendingCelebrations } from '@/lib/achievements'
import type { Novedad } from '@/lib/novedades'
import { useNovedades } from './use-novedades'

const OPEN_DELAY_MS = 1500

/**
 * Anuncia con una ventana la novedad destacada más nueva que el usuario no vio. Las versiones sin destacar sólo
 * prenden el punto de la campanita. Espera a que no haya logros por festejar, para no abrir dos ventanas a la vez, y
 * no aparece en la propia sección de novedades. Cerrarla marca todo como visto.
 */
export function NovedadesHost() {
  const { achievements } = useData()
  const { unseen, markSeen } = useNovedades()
  const pathname = usePathname()
  const [shown, setShown] = useState<Novedad | null>(null)
  const [open, setOpen] = useState(false)

  const destacada = unseen.find(n => n.destacado) ?? null
  const celebrating = pendingCelebrations(achievements).length > 0
  const blocked = celebrating || pathname === '/novedades'

  useEffect(() => {
    if (!destacada || blocked || open) return
    const t = setTimeout(() => {
      setShown(destacada)
      setOpen(true)
    }, OPEN_DELAY_MS)
    return () => clearTimeout(t)
  }, [destacada, blocked, open])

  function close() {
    setOpen(false)
    markSeen()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && close()}>
      <DialogContent>
        {shown && (
          <>
            <DialogHeader>
              <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <DialogTitle>Novedades de la versión {shown.version}</DialogTitle>
              <DialogDescription>Esto es lo nuevo en AutoCar.</DialogDescription>
            </DialogHeader>
            <ul className="space-y-3">
              {shown.items.map(item => (
                <li key={item.title} className="text-sm">
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-0.5 text-muted-foreground">{item.text}</p>
                </li>
              ))}
            </ul>
            <DialogFooter className="flex-col-reverse sm:flex-row sm:justify-end">
              <Link href="/novedades" onClick={close} className={buttonVariants({ variant: 'ghost', size: 'lg', className: 'h-11 sm:h-9' })}>
                Ver todas
              </Link>
              <Button onClick={close} size="lg" className="h-11 sm:h-9">
                Entendido
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
