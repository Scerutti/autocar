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
 * Anuncia con una ventana las versiones nuevas que el usuario no vio. Con una sola se titula con su versión; con
 * varias las muestra todas, de la más nueva a la más vieja, cada una con su versión como subtítulo. La lista scrollea
 * dentro de la ventana, que no pasa el alto de la pantalla. Espera a que no haya logros por festejar, para no abrir
 * dos ventanas a la vez, y no aparece en la propia sección de novedades. Cerrarla marca todo como visto.
 */
export function NovedadesHost() {
  const { achievements } = useData()
  const { unseen, markSeen } = useNovedades()
  const pathname = usePathname()
  const [shown, setShown] = useState<Novedad[]>([])
  const [open, setOpen] = useState(false)

  const celebrating = pendingCelebrations(achievements).length > 0
  const blocked = celebrating || pathname === '/novedades'

  useEffect(() => {
    if (!unseen.length || blocked || open) return
    const t = setTimeout(() => {
      setShown(unseen)
      setOpen(true)
    }, OPEN_DELAY_MS)
    return () => clearTimeout(t)
  }, [unseen, blocked, open])

  function close() {
    setOpen(false)
    markSeen()
  }

  return (
    <Dialog open={open} onOpenChange={next => !next && close()}>
      <DialogContent>
        {shown.length > 0 && (
          <>
            <DialogHeader>
              <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <DialogTitle>{shown.length === 1 ? `Novedades de la versión ${shown[0].version}` : 'Novedades de AutoCar'}</DialogTitle>
              <DialogDescription>
                {shown.length === 1 ? 'Esto es lo nuevo en AutoCar.' : `Esto es lo nuevo en AutoCar en las últimas ${shown.length} versiones.`}
              </DialogDescription>
            </DialogHeader>
            <div className="-mx-5 min-h-0 space-y-5 overflow-y-auto px-5">
              {shown.map(n => (
                <section key={n.version}>
                  {shown.length > 1 && <h3 className="mb-2 text-sm font-semibold text-primary">Versión {n.version}</h3>}
                  <ul className="space-y-3">
                    {n.items.map(item => (
                      <li key={item.title} className="text-sm">
                        <p className="font-medium">{item.title}</p>
                        <p className="mt-0.5 text-muted-foreground">{item.text}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <DialogFooter className="shrink-0 flex-col-reverse sm:flex-row sm:justify-end">
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
