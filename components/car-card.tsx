'use client'

import Link from 'next/link'
import { ChevronRight, Gauge, Plus, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import { formatDate, formatNumber, timeAgo } from '@/lib/format'
import { describeRemaining, type RuleWithState } from '@/lib/maintenance'
import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'
import { CAR_ACCENTS, CarAvatar, RuleProgress, STATUS_TEXT, StatusBadge, carDetail, carName } from './common'

export function CarCard({
  car,
  index,
  rules,
  onUpdateKm,
}: {
  car: Car
  index: number
  rules: RuleWithState[]
  onUpdateKm: () => void
}) {
  const next = rules[0]
  const remaining = next ? describeRemaining(next.state) : null

  return (
    <Card
      className={cn(
        'relative gap-0 overflow-hidden border-white/8 bg-card/80 bg-gradient-to-br to-transparent py-0 shadow-2xl shadow-black/10 ring-white/8',
        CAR_ACCENTS[index % CAR_ACCENTS.length],
      )}
    >
      {car.photoUrl && (
        <Link href={`/autos/${car.id}`} className="relative block aspect-[16/7] overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={cloudinaryUrl(car.photoUrl, 'c_fill,g_auto,w_900,h_394')} alt={carName(car)} className="size-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/10 to-transparent" />
        </Link>
      )}
      <div className="absolute right-[-20px] top-[-30px] size-36 rounded-full bg-white/[0.03] blur-2xl" />
      <Link href={`/autos/${car.id}`} className={cn('relative flex items-start justify-between gap-3 px-4 pb-4', car.photoUrl ? '-mt-8 pt-0' : 'pt-4')}>
        <div className="flex min-w-0 items-start gap-3">
          {!car.photoUrl && <CarAvatar car={car} />}
          <div className="min-w-0">
            <h3 className="truncate text-lg font-semibold tracking-tight">{carName(car)}</h3>
            <p className="mt-1 truncate text-xs text-muted-foreground">{carDetail(car) || 'Tocá para ver el detalle'}</p>
          </div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" />
      </Link>
      <CardContent className="relative space-y-5 pb-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">Kilometraje actual</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              {formatNumber(car.currentKm)} <span className="text-sm font-normal text-muted-foreground">km</span>
            </p>
          </div>
          {car.kmUpdatedAt && (
            <p className="pb-1 text-right text-[11px] text-muted-foreground">Actualizado {timeAgo(car.kmUpdatedAt)}</p>
          )}
        </div>
        {next ? (
          <Link href={`/autos/${car.id}/mantenimientos/${next.rule.id}`} className="block rounded-xl border border-white/8 bg-background/30 p-3.5 hover:bg-background/50">
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
        ) : (
          <Link
            href={`/autos/${car.id}/mantenimientos/nuevo`}
            className="flex items-center gap-2 rounded-xl border border-dashed border-white/10 p-3.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-4" /> Agregá el primer mantenimiento (service, VTV…)
          </Link>
        )}
        <Button onClick={onUpdateKm} className="h-10 w-full gap-2 bg-foreground text-background hover:bg-foreground/90">
          <Gauge /> Cargar km
        </Button>
      </CardContent>
    </Card>
  )
}
