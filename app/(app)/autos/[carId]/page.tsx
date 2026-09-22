'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { CalendarClock, ChevronRight, Fuel, Gauge, Pencil, Plus, Trash2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ActivityList, mergeActivity } from '@/components/activity'
import { ChartCard, KmChart } from '@/components/charts'
import {
  CarAvatar,
  EmptyState,
  LinkButton,
  Loading,
  NotFound,
  PageBody,
  PageHeader,
  RuleProgress,
  StatusBadge,
  carDetail,
  carName,
} from '@/components/common'
import { useConfirm } from '@/components/confirm-provider'
import { KmDialog } from '@/components/km-form'
import { useCar, useData } from '@/components/providers/data-provider'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import { toISODate } from '@/lib/dates'
import { deleteReading, restoreReading } from '@/lib/db'
import { computeCostPerKm, computeFuelStats, fuelLabel, lastPrices } from '@/lib/fuel'
import { formatDate, formatKm, formatMoney, formatMoneyPrecise, formatNumber, timeAgo } from '@/lib/format'
import { describeRemaining, describeRuleInterval, type RuleWithState } from '@/lib/maintenance'
import { FUEL_LABELS, FUEL_UNITS, type Car, type FuelLoad, type Job, type OdometerReading } from '@/lib/types'
import { removeWithUndo } from '@/lib/use-saver'

const TABS = ['estado', 'trabajos', 'combustible', 'km'] as const
type Tab = (typeof TABS)[number]

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/8 bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function RulesTab({ car, rules }: { car: Car; rules: RuleWithState[] }) {
  if (!rules.length) {
    return (
      <EmptyState
        icon={Wrench}
        title="Sin mantenimientos"
        description="Agregá el service, la VTV, el seguro… y te avisamos antes de que venzan."
        action={
          <LinkButton href={`/autos/${car.id}/mantenimientos/nuevo`} size="lg" className="gap-2">
            <Plus /> Agregar mantenimiento
          </LinkButton>
        }
      />
    )
  }
  return (
    <div className="space-y-3">
      {rules.map(({ rule, state }) => {
        const r = describeRemaining(state)
        return (
          <Link
            key={rule.id}
            href={`/autos/${car.id}/mantenimientos/${rule.id}`}
            className="block rounded-xl border border-white/8 bg-card/60 p-4 transition hover:bg-card"
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 truncate font-medium">
                  {!rule.repeat && <CalendarClock aria-hidden className="size-4 shrink-0 text-primary" />}
                  {rule.name}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">{describeRuleInterval(rule)}</p>
              </div>
              <StatusBadge status={state.status} />
            </div>
            <RuleProgress progress={state.progress} status={state.status} />
            <div className="mt-3 grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
              {state.nextKm != null && (
                <p>
                  <span className="text-foreground">{r.km}</span> · a los {formatKm(state.nextKm)}
                </p>
              )}
              {state.nextDate && (
                <p className="sm:text-right">
                  <span className="text-foreground">{r.date}</span> · {formatDate(state.nextDate)}
                </p>
              )}
              {state.estimatedKmDate && state.status !== 'overdue' && (
                <p className="sm:col-span-2">A tu ritmo, llegás a los km aprox. el {formatDate(state.estimatedKmDate)}</p>
              )}
            </div>
          </Link>
        )
      })}
      <LinkButton href={`/autos/${car.id}/mantenimientos/nuevo`} variant="ghost" className="w-full gap-2 text-muted-foreground">
        <Plus /> Agregar mantenimiento
      </LinkButton>
    </div>
  )
}

function JobsTab({ car, jobs, carById }: { car: Car; jobs: Job[]; carById: Map<string, Car> }) {
  if (!jobs.length) {
    return (
      <EmptyState
        icon={Wrench}
        title="Sin trabajos registrados"
        description="Registrá lo que le hacés al auto y cuánto salió."
        action={
          <LinkButton href={`/autos/${car.id}/trabajos/nuevo`} size="lg" className="gap-2">
            <Plus /> Agregar trabajo
          </LinkButton>
        }
      />
    )
  }
  const years = [...new Set(jobs.map(j => j.date.slice(0, 4)))]
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Total histórico: <span className="font-medium text-foreground">{formatMoney(jobs.reduce((s, j) => s + j.cost, 0))}</span>
      </p>
      {years.map(y => {
        const ofYear = jobs.filter(j => j.date.startsWith(y))
        return (
          <section key={y}>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <h3 className="font-semibold">{y}</h3>
              <span className="tabular-nums text-muted-foreground">{formatMoney(ofYear.reduce((s, j) => s + j.cost, 0))}</span>
            </div>
            <ActivityList items={mergeActivity(ofYear, [])} carById={carById} />
          </section>
        )
      })}
    </div>
  )
}

function FuelTab({ car, fuel, carById }: { car: Car; fuel: FuelLoad[]; carById: Map<string, Car> }) {
  if (!fuel.length) {
    return (
      <EmptyState
        icon={Fuel}
        title="Sin cargas de combustible"
        description={`Registrá cada carga de ${car.fuelTypes.map(t => FUEL_LABELS[t]).join(' o ')} para ver consumo y costo por km.`}
        action={
          <LinkButton href={`/autos/${car.id}/combustible/nuevo`} size="lg" className="gap-2">
            <Plus /> Agregar carga
          </LinkButton>
        }
      />
    )
  }
  const single = car.fuelTypes.length === 1
  const costPerKm = computeCostPerKm(fuel)
  const types = car.fuelTypes.filter(t => fuel.some(f => f.fuelType === t))
  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-base font-semibold">Resumen de combustible</h2>
        <p className="mb-3 mt-0.5 text-sm text-muted-foreground">Cuánto te cuesta andar y lo último que pagaste.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Costo por km" value={costPerKm != null ? formatMoneyPrecise(costPerKm) : '—'} hint={costPerKm == null ? 'Necesita dos cargas con km' : 'Todos los combustibles'} />
        {types.map(t => {
          const s = computeFuelStats(fuel, t, single)
          const unit = FUEL_UNITS[t]
          return single ? (
            <Stat
              key={t}
              label={`Consumo ${FUEL_LABELS[t]}`}
              value={s.consumption != null ? `${formatNumber(s.consumption)} km/${unit}` : '—'}
              hint={s.consumption == null ? 'Necesita dos cargas de tanque lleno con km' : 'Tanque lleno a tanque lleno'}
            />
          ) : (
            <Stat key={t} label={`Gastado en ${FUEL_LABELS[t]}`} value={formatMoney(s.totalSpent)} hint={`${formatNumber(s.totalQuantity)} ${unit} en ${s.loads} ${s.loads === 1 ? 'carga' : 'cargas'}`} />
          )
        })}
        {lastPrices(fuel).map(p => (
          <Stat
            key={`price-${p.fuelType}-${p.grade}`}
            label={`Último precio ${fuelLabel(p)}`}
            value={formatMoneyPrecise(p.unitPrice)}
            hint={`por ${FUEL_UNITS[p.fuelType]} · ${formatDate(p.date)}`}
          />
        ))}
      </div>
      </section>
      <section>
        <h2 className="mb-3 text-base font-semibold">Cargas</h2>
        <ActivityList items={mergeActivity([], fuel)} carById={carById} />
      </section>
    </div>
  )
}

const SOURCE_LABELS: Record<OdometerReading['source'], string> = {
  initial: 'Alta del auto',
  manual: 'Carga manual',
  job: 'Desde un trabajo',
  fuel: 'Desde una carga',
}

function KmTab({ car, readings }: { car: Car; readings: OdometerReading[] }) {
  const { uid, odometer } = useData()
  const confirm = useConfirm()

  // Para corregir un error de tipeo. Igual queda "Deshacer" en el aviso.
  async function remove(r: OdometerReading) {
    const confirmed = await confirm({
      tone: 'danger',
      title: `¿Borrar el registro de ${formatKm(r.km)}?`,
      description: `Del ${formatDate(toISODate(r.date))}. Usalo sólo si lo cargaste mal: el km del auto se vuelve a calcular con los otros registros.`,
      confirmLabel: 'Sí, borrar',
    })
    if (!confirmed) return
    removeWithUndo({
      message: `Registro de ${formatKm(r.km)} borrado`,
      remove: () => deleteReading(uid, car, odometer, r.id),
      restore: () => restoreReading(uid, car, odometer, r),
    })
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Km actuales" value={formatNumber(car.currentKm)} hint={car.kmUpdatedAt ? `Actualizado ${timeAgo(car.kmUpdatedAt)}` : undefined} />
        <Stat
          label="Uso promedio"
          value={car.avgKmPerDay != null ? `${formatNumber(Math.round(car.avgKmPerDay * 7))} km/sem` : '—'}
          hint={car.avgKmPerDay != null ? `${formatNumber(car.avgKmPerDay)} km por día` : 'Se calcula con registros de varios días'}
        />
      </div>
      <ChartCard title="Cómo fueron subiendo los km" description="Cada punto es un registro de kilometraje. Tocá la línea para ver la fecha y los km de cada uno.">
        <KmChart readings={readings} />
      </ChartCard>
      <section>
        <h2 className="mb-3 text-base font-semibold">Registros de km</h2>
      <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-card/60">
        {readings.map(r => (
          <div key={r.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium tabular-nums">{formatKm(r.km)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(toISODate(r.date))} · {SOURCE_LABELS[r.source]}
              </p>
            </div>
            {readings.length > 1 && (
              <Button variant="ghost" size="icon-sm" aria-label={`Borrar el registro de ${formatKm(r.km)}`} className="text-muted-foreground hover:text-destructive" onClick={() => remove(r)}>
                <Trash2 />
              </Button>
            )}
          </div>
        ))}
      </div>
      </section>
    </div>
  )
}

function CarDetail() {
  const { carId } = useParams<{ carId: string }>()
  const router = useRouter()
  const params = useSearchParams()
  const { carById } = useData()
  const { car, rules, jobs, fuel, readings } = useCar(carId)
  const [showKm, setShowKm] = useState(false)
  const tabParam = params.get('tab') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'estado'

  if (!car) return <NotFound what="el auto" />

  return (
    <>
      <PageHeader
        back="/"
        title={carName(car)}
        subtitle={carDetail(car) || undefined}
        actions={
          <LinkButton href={`/autos/${car.id}/editar`} variant="outline" size="icon" aria-label="Editar auto" className="size-9 border-white/10 bg-white/[0.03]">
            <Pencil />
          </LinkButton>
        }
      />
      <PageBody className="space-y-6">
        <div className="overflow-hidden rounded-2xl border border-white/8 bg-card/60">
          {car.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={cloudinaryUrl(car.photoUrl, 'c_fill,g_auto,w_1200,h_500')} alt={carName(car)} className="aspect-[12/5] w-full object-cover" />
          )}
          <div className="flex flex-wrap items-end justify-between gap-4 p-5">
            <div className="flex items-center gap-4">
              {!car.photoUrl && <CarAvatar car={car} className="size-14" />}
              <div>
                <p className="text-xs text-muted-foreground">Kilometraje actual</p>
                <p className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
                  {formatNumber(car.currentKm)} <span className="text-sm font-normal text-muted-foreground">km</span>
                </p>
                {car.kmUpdatedAt && <p className="mt-0.5 text-xs text-muted-foreground">Actualizado {timeAgo(car.kmUpdatedAt)}</p>}
              </div>
            </div>
            <Button onClick={() => setShowKm(true)} className="h-10 gap-2 bg-foreground px-4 text-background hover:bg-foreground/90">
              <Gauge /> Cargar km
            </Button>
          </div>
          <div className="grid grid-cols-3 border-t border-white/8">
            {[
              { href: `/autos/${car.id}/trabajos/nuevo`, icon: Wrench, label: 'Trabajo' },
              { href: `/autos/${car.id}/combustible/nuevo`, icon: Fuel, label: 'Carga' },
              { href: `/autos/${car.id}/mantenimientos/nuevo`, icon: Plus, label: 'Mantenimiento' },
            ].map(({ href, icon: Icon, label }) => (
              <Link
                key={href}
                href={href}
                className="flex flex-col items-center gap-1.5 border-r border-white/8 py-3.5 text-xs text-muted-foreground transition last:border-r-0 hover:bg-white/[0.03] hover:text-foreground sm:flex-row sm:justify-center sm:text-sm"
              >
                <Icon className="size-4 text-primary" />+ {label}
              </Link>
            ))}
          </div>
        </div>

        <Tabs value={tab} onValueChange={v => router.replace(`/autos/${car.id}?tab=${v}`, { scroll: false })}>
          <TabsList className="h-10! w-full">
            <TabsTrigger value="estado">Estado</TabsTrigger>
            <TabsTrigger value="trabajos">Trabajos</TabsTrigger>
            <TabsTrigger value="combustible">Combustible</TabsTrigger>
            <TabsTrigger value="km">Km</TabsTrigger>
          </TabsList>
          <TabsContent value="estado" className="pt-4">
            <RulesTab car={car} rules={rules} />
          </TabsContent>
          <TabsContent value="trabajos" className="pt-4">
            <JobsTab car={car} jobs={jobs} carById={carById} />
          </TabsContent>
          <TabsContent value="combustible" className="pt-4">
            <FuelTab car={car} fuel={fuel} carById={carById} />
          </TabsContent>
          <TabsContent value="km" className="pt-4">
            <KmTab car={car} readings={readings} />
          </TabsContent>
        </Tabs>

        <Link href={`/gastos?auto=${car.id}`} className="flex items-center justify-between rounded-xl border border-white/8 bg-card/60 px-4 py-3.5 text-sm hover:bg-card">
          Ver resumen de gastos de este auto <ChevronRight className="size-4 text-muted-foreground" />
        </Link>
      </PageBody>
      <KmDialog car={showKm ? car : null} onClose={() => setShowKm(false)} />
    </>
  )
}

export default function CarDetailPage() {
  return (
    <Suspense fallback={<Loading />}>
      <CarDetail />
    </Suspense>
  )
}
