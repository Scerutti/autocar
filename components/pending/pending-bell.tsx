'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, Gauge, Sparkles } from 'lucide-react'
import { StatusBadge, carName } from '@/components/common'
import { KmDialog } from '@/components/km-form'
import { useNovedades } from '@/components/novedades/use-novedades'
import { useData } from '@/components/providers/data-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { describeRemaining } from '@/lib/maintenance'
import { kmDueDay, pendingItems, urgentCount, type PendingItem } from '@/lib/pending'
import { cn } from '@/lib/utils'

const ROW = 'flex items-center gap-3 px-4 py-3.5 hover:bg-white/[0.02]'

function RuleRow({ item, onNavigate }: { item: Extract<PendingItem, { kind: 'rule' }>; onNavigate: () => void }) {
  const { car, rule, state } = item
  const r = describeRemaining(state)
  return (
    <Link href={`/autos/${car.id}/mantenimientos/${rule.id}`} onClick={onNavigate} className={ROW}>
      <div
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-xl',
          state.status === 'overdue' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning',
        )}
      >
        <AlertTriangle className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{rule.name}</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {carName(car)} · {[r.km, r.date].filter(Boolean).join(' · ')}
        </p>
      </div>
      <StatusBadge status={state.status} />
    </Link>
  )
}

/**
 * Campanita de la cabecera: junta lo pendiente (km por cargar, mantenimientos vencidos o por vencer) y las
 * novedades sin ver. Todo sale de los datos, no de las notificaciones: lo resuelto desaparece solo, aunque se
 * haya descartado el aviso del celular. El número cuenta lo urgente y las novedades; los por vencer no suman.
 */
export function PendingBell() {
  const { settings, cars, rulesByCar, today, carById } = useData()
  const { unseen } = useNovedades()
  const [open, setOpen] = useState(false)
  const [kmCarId, setKmCarId] = useState<string | null>(null)

  const items = useMemo(() => pendingItems({ settings, cars, rulesByCar, today }), [settings, cars, rulesByCar, today])
  const count = urgentCount(items) + (unseen.length ? 1 : 0)
  const close = () => setOpen(false)

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        aria-label={count ? `Pendientes: ${count}` : 'Pendientes'}
        className="relative size-9 border-white/10 bg-white/[0.03]"
      >
        <Bell />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold tabular-nums text-white ring-2 ring-background"
          >
            {count > 9 ? '9+' : count}
          </span>
        )}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Pendientes</DialogTitle>
            <DialogDescription>
              {items.length || unseen.length ? 'Lo que tenés para hacer en tus autos.' : 'No tenés nada para hacer.'}
            </DialogDescription>
          </DialogHeader>

          {items.length === 0 && unseen.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <CheckCircle2 className="size-10 text-success" />
              <p className="font-medium">Todo al día</p>
              <p className="text-sm text-muted-foreground">Cuando haya algo para revisar te lo mostramos acá.</p>
            </div>
          ) : (
            <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-card/60">
              {unseen.length > 0 && (
                <Link href="/novedades" onClick={close} className={ROW}>
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Sparkles className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">Novedades de la versión {unseen[0].version}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">Mirá qué hay de nuevo en la app.</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              )}
              {items.map(item =>
                item.kind === 'km' ? (
                  <div key={`km-${item.car.id}`} className="flex items-center gap-3 px-4 py-3.5">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
                      <Gauge className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">Cargar los km</p>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {carName(item.car)} · te los pedimos {kmDueDay(item.since, today)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => {
                        close()
                        setKmCarId(item.car.id)
                      }}
                    >
                      Cargar
                    </Button>
                  </div>
                ) : (
                  <RuleRow key={item.rule.id} item={item} onNavigate={close} />
                ),
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <KmDialog car={kmCarId ? (carById.get(kmCarId) ?? null) : null} onClose={() => setKmCarId(null)} />
    </>
  )
}
