'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Bell, CheckCircle2, ChevronRight, CircleCheck, CircleX, Gauge, Sparkles, Users, Wrench } from 'lucide-react'
import { StatusBadge, carName } from '@/components/common'
import { useJobReview } from '@/components/forms/job-form'
import { inviterName, useInviteResponse } from '@/components/invites/invite-card'
import { KmDialog } from '@/components/km-form'
import { useNovedades } from '@/components/novedades/use-novedades'
import { useData } from '@/components/providers/data-provider'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatDate, formatMoney } from '@/lib/format'
import { describeRemaining } from '@/lib/maintenance'
import { kmDueDay, pendingItems, urgentCount, type PendingItem } from '@/lib/pending'
import { authorLabel } from '@/lib/sharing'
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
 * Trabajo que cargó un miembro en un auto mío: link al detalle y, ahí mismo, Aprobar y Rechazar. Aprobar y
 * Rechazar cierran la campanita antes de confirmar, como "Cargar" los km: así no quedan dos ventanas abiertas.
 */
function ReviewRow({ item, onNavigate }: { item: Extract<PendingItem, { kind: 'review' }>; onNavigate: () => void }) {
  const { car, job } = item
  const { uid } = useData()
  const { approve, reject } = useJobReview()
  return (
    <div className="px-4 py-3.5">
      <Link href={`/autos/${car.id}/trabajos/${job.id}`} onClick={onNavigate} className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-warning/10 text-warning">
          <Wrench className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">Revisar: {job.title}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {carName(car)} · {authorLabel(job, car, uid)} · {formatDate(job.date)} · {formatMoney(job.cost)}
          </p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      <div className="mt-2.5 flex gap-2 pl-12">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            onNavigate()
            void approve(car, job)
          }}
        >
          <CircleCheck /> Aprobar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            onNavigate()
            void reject(car, job)
          }}
        >
          <CircleX /> Rechazar
        </Button>
      </div>
    </div>
  )
}

/**
 * Invitación a compartir un auto: link a la página de la invitación y, ahí mismo, Aceptar y Rechazar. Como en
 * `ReviewRow`, cierran la campanita antes de confirmar.
 */
function InviteRow({ item, onNavigate }: { item: Extract<PendingItem, { kind: 'invite' }>; onNavigate: () => void }) {
  const { invite } = item
  const { accept, decline } = useInviteResponse()
  return (
    <div className="px-4 py-3.5">
      <Link href={`/invitaciones/${encodeURIComponent(invite.id)}`} onClick={onNavigate} className="flex items-center gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Users className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {inviterName(invite)} te invitó a compartir su {invite.carLabel}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">Aceptala para ver el auto y cargar combustible, km y trabajos.</p>
        </div>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
      <div className="mt-2.5 flex gap-2 pl-12">
        <Button
          size="sm"
          className="gap-1.5"
          onClick={() => {
            onNavigate()
            void accept(invite)
          }}
        >
          <CircleCheck /> Aceptar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            onNavigate()
            void decline(invite)
          }}
        >
          <CircleX /> Rechazar
        </Button>
      </div>
    </div>
  )
}

/**
 * Campanita de la cabecera: junta lo pendiente (km por cargar, mantenimientos vencidos o por vencer, trabajos de
 * los miembros para revisar, mis trabajos rechazados y las invitaciones a compartir un auto) y las novedades sin
 * ver. Todo sale de los datos, no de las notificaciones: lo resuelto desaparece solo, aunque se haya descartado el
 * aviso del celular. El número cuenta todo menos los por vencer, más las novedades.
 */
export function PendingBell() {
  const { settings, cars, rulesByCar, jobs, uid, today, carById, myInvites } = useData()
  const { unseen } = useNovedades()
  const [open, setOpen] = useState(false)
  const [kmCarId, setKmCarId] = useState<string | null>(null)

  const items = useMemo(
    () => pendingItems({ settings, cars, rulesByCar, jobs, uid, invites: myInvites, now: new Date(), today }),
    [settings, cars, rulesByCar, jobs, uid, myInvites, today],
  )
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
              {items.map(item => {
                if (item.kind === 'km') {
                  return (
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
                  )
                }
                if (item.kind === 'review') return <ReviewRow key={`review-${item.job.id}`} item={item} onNavigate={close} />
                if (item.kind === 'rejected') {
                  return (
                    <Link key={`rejected-${item.job.id}`} href={`/autos/${item.car.id}/trabajos/${item.job.id}`} onClick={close} className={ROW}>
                      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
                        <CircleX className="size-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">Rechazado: {item.job.title}</p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">
                          {carName(item.car)} · corregilo y volvé a mandarlo, o borralo
                        </p>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  )
                }
                if (item.kind === 'invite') return <InviteRow key={`invite-${item.invite.id}`} item={item} onNavigate={close} />
                return <RuleRow key={item.rule.id} item={item} onNavigate={close} />
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <KmDialog car={kmCarId ? (carById.get(kmCarId) ?? null) : null} onClose={() => setKmCarId(null)} />
    </>
  )
}
