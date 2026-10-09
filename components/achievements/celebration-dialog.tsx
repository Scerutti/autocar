'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { ArrowLeft, ChevronRight, Trophy, X } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { carName } from '@/components/common'
import { celebrationMode, type AchievementStatus } from '@/lib/achievements'
import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Medal } from './medal'

// Colores del confeti: azul de la marca, dorado de las medallas y tonos de las categorías.
const CONFETTI = ['#1a9cfb', '#f5b829', '#fde68a', '#fb923c', '#a78bfa', '#22d3ee', '#f472b6']

/** Destellos que salen de la medalla. Posiciones fijas (no al azar) para que se vea igual siempre. */
function Burst({ big }: { big: boolean }) {
  const n = big ? 22 : 14
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 motion-reduce:hidden">
      {Array.from({ length: n }, (_, i) => {
        const angle = (Math.PI * 2 * i) / n + (i % 2) * 0.2
        const dist = (big ? 92 : 74) + (i % 3) * 14
        const square = i % 3 === 0
        return (
          <span
            key={i}
            className={cn('absolute left-1/2 top-1/2 -ml-1 -mt-1 animate-confetti', square ? 'size-2 rounded-[2px]' : 'size-1.5 rounded-full')}
            style={
              {
                backgroundColor: CONFETTI[i % CONFETTI.length],
                '--tx': `${Math.round(Math.cos(angle) * dist)}px`,
                '--ty': `${Math.round(Math.sin(angle) * dist)}px`,
                '--rot': `${(i % 2 ? 1 : -1) * (120 + i * 15)}deg`,
                animationDelay: `${120 + (i % 4) * 40}ms`,
              } as React.CSSProperties
            }
          />
        )
      })}
    </div>
  )
}

function Hero({ status }: { status: AchievementStatus }) {
  const big = Boolean(status.def.milestone)
  return (
    <div className="relative mx-auto flex size-44 items-center justify-center">
      <div
        aria-hidden
        className={cn(
          'absolute inset-4 animate-glow rounded-full blur-2xl motion-reduce:animate-none',
          big ? 'bg-amber-300/40' : 'bg-primary/30',
        )}
      />
      <Burst big={big} />
      <Medal
        id={status.def.id}
        category={status.def.category}
        state="unlocked"
        className={cn('relative animate-medal-pop motion-reduce:animate-none', big ? 'size-32' : 'size-28')}
      />
    </div>
  )
}

function Dots({ count, index }: { count: number; index: number }) {
  return (
    <div aria-hidden className="flex items-center justify-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn('h-1.5 rounded-full transition-all motion-reduce:transition-none', i === index ? 'w-5 bg-primary' : 'w-1.5 bg-white/20')} />
      ))}
    </div>
  )
}

type View = { kind: 'item'; index: number; fromSummary: boolean } | { kind: 'summary' }

/**
 * Celebración de logros nuevos. Uno: se muestra solo. De 2 a 4: de a uno, con "1 de 3", "Siguiente" y
 * "Saltar" (al resumen). Cinco o más: primero el resumen, y desde ahí se puede ver cada uno.
 */
export function CelebrationDialog({
  open,
  items,
  carById,
  onSeen,
  onClose,
  onClosed,
}: {
  open: boolean
  items: AchievementStatus[]
  /** Sólo con más de un auto: para decir con cuál se consiguió. */
  carById: Map<string, Car> | null
  /** Se mostró uno (o varios): ya no tiene que volver a aparecer. */
  onSeen: (ids: string[]) => void
  onClose: () => void
  /** Terminó la animación de cierre. */
  onClosed: () => void
}) {
  const mode = celebrationMode(items.length)
  const [view, setView] = useState<View>(() => (mode === 'summary' ? { kind: 'summary' } : { kind: 'item', index: 0, fromSummary: false }))
  const primaryRef = useRef<HTMLButtonElement>(null)

  // El que se está viendo cuenta como visto (si se corta la app a mitad de la tanda, no se repite).
  const current = view.kind === 'item' ? items[view.index] : null
  useEffect(() => {
    if (view.kind === 'summary') onSeen(items.map(s => s.def.id))
    else if (current) onSeen([current.def.id])
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar de logro el foco sigue en el botón principal (el contenido se vuelve a montar).
  useEffect(() => {
    if (open) primaryRef.current?.focus()
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps

  const isLast = view.kind === 'item' && view.index === items.length - 1
  const milestone = view.kind === 'item' && current?.def.milestone

  return (
    <DialogPrimitive.Root open={open} onOpenChange={next => !next && onClose()} onOpenChangeComplete={next => !next && onClosed()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/70 backdrop-blur-[3px] transition-opacity duration-300 data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none" />
        <DialogPrimitive.Viewport className="fixed inset-0 z-50 flex items-center justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))]">
          <DialogPrimitive.Popup
            initialFocus={primaryRef}
            className={cn(
              'relative flex max-h-full w-full max-w-sm flex-col overflow-y-auto overflow-x-hidden overscroll-contain rounded-3xl border border-white/10 bg-popover text-popover-foreground shadow-2xl shadow-black/60 outline-none',
              'transition-[scale,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] data-starting-style:scale-90 data-starting-style:opacity-0 data-ending-style:scale-95 data-ending-style:opacity-0 motion-reduce:transition-none',
              milestone
                ? 'bg-[radial-gradient(120%_60%_at_50%_0%,rgba(245,184,41,0.22),transparent_70%)]'
                : 'bg-[radial-gradient(120%_60%_at_50%_0%,rgba(26,156,251,0.2),transparent_70%)]',
            )}
          >
            <DialogPrimitive.Close
              aria-label="Cerrar"
              className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-xl text-muted-foreground outline-none transition hover:bg-white/5 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>

            {view.kind === 'summary' ? (
              <div key="summary" className="flex animate-rise flex-col gap-5 px-5 pb-5 pt-8 motion-reduce:animate-none">
                <div className="text-center">
                  <div className="relative mx-auto flex size-24 items-center justify-center">
                    <div aria-hidden className="absolute inset-2 animate-glow rounded-full bg-amber-300/30 blur-2xl motion-reduce:animate-none" />
                    <Burst big={false} />
                    <div className="relative flex size-20 animate-medal-pop items-center justify-center rounded-full bg-gradient-to-br from-[#fde68a] via-[#f5b829] to-[#b45309] shadow-[0_6px_18px_rgba(245,184,41,0.3)] motion-reduce:animate-none">
                      <Trophy aria-hidden className="size-9 text-white drop-shadow" />
                    </div>
                  </div>
                  <DialogPrimitive.Title className="mt-4 text-2xl font-semibold tracking-tight">
                    ¡{items.length} logros nuevos!
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                    Tu constancia se nota. Tocá uno para verlo.
                  </DialogPrimitive.Description>
                </div>
                <ul className="divide-y divide-white/8 overflow-hidden rounded-2xl border border-white/8 bg-background/40">
                  {items.map((s, index) => (
                    <li key={s.def.id}>
                      <button
                        type="button"
                        onClick={() => setView({ kind: 'item', index, fromSummary: true })}
                        className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left outline-none transition hover:bg-white/[0.04] focus-visible:bg-white/[0.06]"
                      >
                        <Medal id={s.def.id} category={s.def.category} state="unlocked" className="size-9" />
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.def.name}</span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>
                <Footer primaryRef={primaryRef} onClose={onClose} primaryLabel="Listo" />
              </div>
            ) : current ? (
              <div key={current.def.id} className="flex flex-col gap-5 px-5 pb-5 pt-6">
                <Hero status={current} />
                <div className="animate-rise text-center motion-reduce:animate-none">
                  <p className={cn('text-xs font-semibold uppercase tracking-wide', milestone ? 'text-amber-300' : 'text-primary')}>
                    {milestone ? '¡Un hito!' : '¡Nuevo logro!'}
                  </p>
                  <DialogPrimitive.Title className="mt-1.5 text-2xl font-semibold tracking-tight">{current.def.name}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">
                    {current.def.description}
                  </DialogPrimitive.Description>
                  {carById && current.carId && carById.get(current.carId) && (
                    <p className="mt-2 text-xs text-muted-foreground">Con el {carName(carById.get(current.carId)!)}</p>
                  )}
                </div>

                {mode !== 'single' && (
                  <div className="space-y-1.5">
                    <Dots count={items.length} index={view.index} />
                    <p className="text-center text-xs tabular-nums text-muted-foreground">
                      {view.index + 1} de {items.length}
                    </p>
                  </div>
                )}

                {view.fromSummary ? (
                  <div className="flex gap-3">
                    <Button
                      ref={primaryRef}
                      variant="outline"
                      className="h-11 flex-1 gap-2"
                      onClick={() => setView({ kind: 'summary' })}
                    >
                      <ArrowLeft /> Volver al resumen
                    </Button>
                  </div>
                ) : mode === 'sequence' && !isLast ? (
                  <div className="flex gap-3">
                    <Button variant="ghost" className="h-11 flex-1 text-muted-foreground" onClick={() => setView({ kind: 'summary' })}>
                      Saltar
                    </Button>
                    <Button
                      ref={primaryRef}
                      className="h-11 flex-[2]"
                      onClick={() => setView({ kind: 'item', index: view.index + 1, fromSummary: false })}
                    >
                      Siguiente
                    </Button>
                  </div>
                ) : (
                  <Footer primaryRef={primaryRef} onClose={onClose} primaryLabel="¡Genial!" />
                )}
              </div>
            ) : null}
            <p role="status" className="sr-only">
              {view.kind === 'summary'
                ? `${items.length} logros nuevos`
                : current && `Logro desbloqueado${mode !== 'single' ? ` ${view.index + 1} de ${items.length}` : ''}: ${current.def.name}`}
            </p>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Viewport>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function Footer({
  primaryRef,
  primaryLabel,
  onClose,
}: {
  primaryRef: React.RefObject<HTMLButtonElement | null>
  primaryLabel: string
  onClose: () => void
}) {
  return (
    <div className="flex gap-3">
      <Link href="/logros" onClick={onClose} className={cn(buttonVariants({ variant: 'outline' }), 'h-11 flex-1')}>
        Ver mis logros
      </Link>
      <Button ref={primaryRef} className="h-11 flex-1" onClick={onClose}>
        {primaryLabel}
      </Button>
    </div>
  )
}
