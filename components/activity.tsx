'use client'

import Link from 'next/link'
import {
  BatteryCharging,
  ChevronRight,
  CircleGauge,
  Disc3,
  FileText,
  Fuel,
  PaintBucket,
  ShieldCheck,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { formatMoney, formatNumber, formatShortDate } from '@/lib/format'
import { FUEL_LABELS, FUEL_UNITS, JOB_CATEGORY_LABELS, type Car, type FuelLoad, type Job, type JobCategory } from '@/lib/types'
import { carName } from './common'

export const CATEGORY_ICONS: Record<JobCategory, LucideIcon> = {
  service: Wrench,
  reparacion: ShieldCheck,
  cubiertas: CircleGauge,
  frenos: Disc3,
  electricidad: BatteryCharging,
  carroceria: PaintBucket,
  documentacion: FileText,
  otros: Wrench,
}

export type Activity = { kind: 'job'; item: Job } | { kind: 'fuel'; item: FuelLoad }

export function mergeActivity(jobs: Job[], fuel: FuelLoad[]): Activity[] {
  return [
    ...jobs.map(item => ({ kind: 'job' as const, item })),
    ...fuel.map(item => ({ kind: 'fuel' as const, item })),
  ].sort((a, b) => b.item.date.localeCompare(a.item.date) || b.item.createdAt.getTime() - a.item.createdAt.getTime())
}

export function ActivityRow({ activity, car, showCar }: { activity: Activity; car?: Car; showCar?: boolean }) {
  const { kind, item } = activity
  const Icon = kind === 'job' ? CATEGORY_ICONS[item.category] : Fuel
  const href = kind === 'job' ? `/autos/${item.carId}/trabajos/${item.id}` : `/autos/${item.carId}/combustible/${item.id}`
  const title =
    kind === 'job' ? item.title : `${FUEL_LABELS[item.fuelType]} · ${formatNumber(item.quantity)} ${FUEL_UNITS[item.fuelType]}`
  const meta = [
    showCar && car ? carName(car) : null,
    kind === 'job' ? JOB_CATEGORY_LABELS[item.category] : 'Combustible',
    item.km != null ? `${formatNumber(item.km)} km` : null,
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
        <p className="truncate text-sm font-medium">{title}</p>
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
  return (
    <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-card/60">
      {items.map(a => (
        <ActivityRow key={`${a.kind}-${a.item.id}`} activity={a} car={carById.get(a.item.carId)} showCar={showCar} />
      ))}
    </div>
  )
}
