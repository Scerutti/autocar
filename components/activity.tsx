'use client'

import Link from 'next/link'
import {
  BatteryCharging,
  ChevronRight,
  CircleGauge,
  Disc3,
  Ellipsis,
  FileText,
  Fuel,
  PaintBucket,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { useData } from '@/components/providers/data-provider'
import { Badge } from '@/components/ui/badge'
import { fuelLabel } from '@/lib/fuel'
import { formatMoney, formatNumber, formatShortDate } from '@/lib/format'
import { authorLabel, isSharedCar } from '@/lib/sharing'
import { FUEL_UNITS, JOB_CATEGORY_LABELS, type Authorship, type Car, type FuelLoad, type Job, type JobCategory } from '@/lib/types'
import { cn } from '@/lib/utils'
import { carName } from './common'

export const CATEGORY_ICONS: Record<JobCategory, LucideIcon> = {
  service: Wrench,
  reparacion: ShieldCheck,
  cubiertas: CircleGauge,
  frenos: Disc3,
  electricidad: BatteryCharging,
  carroceria: PaintBucket,
  documentacion: FileText,
  otros: Ellipsis,
}

export type Activity = { kind: 'job'; item: Job } | { kind: 'fuel'; item: FuelLoad }

const JOB_STATUS = {
  pending: { label: 'Pendiente', className: 'border-warning/25 bg-warning/10 text-warning' },
  rejected: { label: 'Rechazado', className: 'border-destructive/25 bg-destructive/10 text-destructive' },
}

/** Etiqueta "Pendiente" o "Rechazado" de un trabajo que todavía no cuenta; nada si está aprobado. */
export function JobStatusBadge({ job, className }: { job: Pick<Job, 'status'>; className?: string }) {
  if (!job.status || job.status === 'approved') return null
  const s = JOB_STATUS[job.status]
  return (
    <Badge variant="outline" className={cn(s.className, className)}>
      {s.label}
    </Badge>
  )
}

/** "Cargado por <nombre>" para un registro de un auto compartido; en un auto sin compartir no muestra nada. */
export function CreatedBy({ record, car, className }: { record: Authorship; car: Car; className?: string }) {
  const { uid } = useData()
  if (!isSharedCar(car, uid)) return null
  return (
    <p className={cn('text-sm text-muted-foreground', className)}>
      Cargado por <span className="font-medium text-foreground">{authorLabel(record, car, uid)}</span>
    </p>
  )
}

/**
 * Datos de un registro que no puedo editar (es de otra persona, o un trabajo ya aprobado): se ven en filas, sin
 * guardar ni borrar, con quién lo cargó y un aviso opcional.
 */
export function ReadOnlyDetails({
  car,
  record,
  rows,
  notice,
  badge,
}: {
  car: Car
  record: Authorship
  rows: { label: string; value: React.ReactNode }[]
  notice?: React.ReactNode
  badge?: React.ReactNode
}) {
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CreatedBy record={record} car={car} />
        {badge}
      </div>
      {notice && <p className="rounded-xl border border-white/8 bg-white/[0.03] px-3.5 py-3 text-sm text-muted-foreground">{notice}</p>}
      <dl className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-card/60">
        {rows.map(r => (
          <div key={r.label} className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
            <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
            <dd className="min-w-0 whitespace-pre-line text-right font-medium">{r.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function mergeActivity(jobs: Job[], fuel: FuelLoad[]): Activity[] {
  return [
    ...jobs.map(item => ({ kind: 'job' as const, item })),
    ...fuel.map(item => ({ kind: 'fuel' as const, item })),
  ].sort((a, b) => b.item.date.localeCompare(a.item.date) || b.item.createdAt.getTime() - a.item.createdAt.getTime())
}

/** Fila de un trabajo o una carga. En un auto compartido dice quién la cargó; un trabajo sin aprobar lleva su etiqueta. */
export function ActivityRow({ activity, car, showCar, uid }: { activity: Activity; car?: Car; showCar?: boolean; uid: string }) {
  const { kind, item } = activity
  const Icon = kind === 'job' ? CATEGORY_ICONS[item.category] : Fuel
  const href = kind === 'job' ? `/autos/${item.carId}/trabajos/${item.id}` : `/autos/${item.carId}/combustible/${item.id}`
  const title =
    kind === 'job' ? item.title : `${fuelLabel(item)} · ${formatNumber(item.quantity)} ${FUEL_UNITS[item.fuelType]}`
  const meta = [
    showCar && car ? carName(car) : null,
    kind === 'job' ? JOB_CATEGORY_LABELS[item.category] : 'Combustible',
    item.km != null ? `${formatNumber(item.km)} km` : null,
    car && isSharedCar(car, uid) ? `Cargado por ${authorLabel(item, car, uid)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')
  const amount = kind === 'job' ? item.cost : item.total

  return (
    <Link href={href} className="flex items-center gap-3 px-4 py-4 transition hover:bg-white/[0.02] sm:px-5">
      <div className="hidden w-12 text-center text-[10px] font-semibold leading-4 text-muted-foreground sm:block">
        {formatShortDate(item.date)}
      </div>
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-muted-foreground">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <span className="truncate">{title}</span>
          {kind === 'job' && <JobStatusBadge job={item} />}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          <span className="sm:hidden">{formatShortDate(item.date)} · </span>
          {meta}
        </p>
      </div>
      <p className="text-sm font-medium tabular-nums">{formatMoney(amount)}</p>
      <ChevronRight className="hidden size-4 text-muted-foreground sm:block" />
    </Link>
  )
}

export function ActivityList({ items, carById, showCar }: { items: Activity[]; carById: Map<string, Car>; showCar?: boolean }) {
  const { uid } = useData()
  return (
    <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-card/60">
      {items.map(a => (
        <ActivityRow key={`${a.kind}-${a.item.id}`} activity={a} car={carById.get(a.item.carId)} showCar={showCar} uid={uid} />
      ))}
    </div>
  )
}
