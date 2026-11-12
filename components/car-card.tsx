'use client'

import Link from 'next/link'
import { ChevronRight, Gauge, Plus, Wrench } from 'lucide-react'
import { useData } from '@/components/providers/data-provider'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import { formatDate, formatNumber, timeAgo } from '@/lib/format'
import { describeRemaining, type RuleWithState } from '@/lib/maintenance'
import { canWrite, isCarOwner } from '@/lib/sharing'
import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CarAvatar, RuleProgress, STATUS_TEXT, StatusBadge, carDetail, carName } from './common'

export function CarCard({
  car,
  rules,
  kmDue = false,
  onUpdateKm,
}: {
  car: Car
  index: number
  rules: RuleWithState[]
  /** Faltan los km del recordatorio semanal: se resalta el botón para cargarlos. */
  kmDue?: boolean
  onUpdateKm: () => void
}) {
  const { uid } = useData()
  const next = rules[0]
  const remaining = next ? describeRemaining(next.state) : null

  return (
    <Card className="relative gap-0 overflow-hidden py-0">
      {car.photoUrl && (
        <Link href={`/autos/${car.id}`} className="relative block aspect-[16/7] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cloudinaryUrl(car.photoUrl, 'c_fill,g_auto,w_900,h_394')} alt={carName(car)} className="size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent" />
        </Link>
      )}
      <Link href={`/autos/${car.id}`} className={cn('relative flex items-start justify-between gap-3 px-4 pb-4', car.photoUrl ? '-mt-8 pt-0' : 'pt-4')}>
        <div className="flex min-w-0 items-start gap-3">
          {!car.photoUrl && <CarAvatar car={car} />}
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold">{carName(car)}</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">{carDetail(car) || 'Tocá para ver el detalle'}</p>
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </Link>
      <CardContent className="relative space-y-4 pb-4">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">Kilometraje actual</p>
            <p className="mt-0.5 font-display text-4xl font-semibold leading-none tabular-nums">
              {formatNumber(car.currentKm)} <span className="font-sans text-sm font-normal text-muted-foreground">km</span>
            </p>
          </div>
          {kmDue ? (
            <p className="pb-1 text-right text-[11px] font-medium text-warning">
              Faltan los km de la semana
              {car.kmUpdatedAt && <span className="block font-normal text-muted-foreground">Actualizado {timeAgo(car.kmUpdatedAt)}</span>}
            </p>
          ) : (
            car.kmUpdatedAt && <p className="pb-1 text-right text-[11px] text-muted-foreground">Actualizado {timeAgo(car.kmUpdatedAt)}</p>
          )}
        </div>
        {next ? (
          <Link href={`/autos/${car.id}/mantenimientos/${next.rule.id}`} className="-mx-4 block border-t border-line px-4 py-3.5 transition hover:bg-surface-2">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
                <Wrench className={cn('size-4 shrink-0', STATUS_TEXT[next.state.status])} />
                <span className="truncate">Próximo: {next.rule.name}</span>
              </div>
              <StatusBadge status={next.state.status} />
            </div>
            <RuleProgress progress={next.state.progress} status={next.state.status} />
            <div className="mt-2 flex justify-between gap-2 text-xs text-muted-foreground">
              <span>{remaining?.km ?? (next.state.nextDate ? formatDate(next.state.nextDate) : '')}</span>
              <span>{remaining?.date ?? (next.state.estimatedKmDate ? `aprox. ${formatDate(next.state.estimatedKmDate)}` : '')}</span>
            </div>
          </Link>
        ) : !isCarOwner(car, uid) ? (
          <p className="-mx-4 border-t border-line px-4 pt-3.5 text-sm text-muted-foreground">Todavía no tiene mantenimientos cargados.</p>
        ) : (
          <Link
            href={`/autos/${car.id}/mantenimientos/nuevo`}
            className="-mx-4 flex items-center gap-2 border-t border-line px-4 pt-3.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-4" /> Agregá el primer mantenimiento (service, VTV…)
          </Link>
        )}
        {canWrite(car, uid) && (
          <Button onClick={onUpdateKm} className={cn('h-10 w-full gap-2', !kmDue && 'bg-foreground text-background hover:bg-foreground/90')}>
            <Gauge /> Cargar km
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
