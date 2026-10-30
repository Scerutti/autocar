'use client'

import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { CalendarClock, ChevronRight, FileText, Fuel, Gauge, LogOut, Pencil, Plus, Trash2, Users, Wrench } from 'lucide-react'
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
import { ExportReportDialog } from '@/components/report/export-dialog'
import { useCar, useData } from '@/components/providers/data-provider'
import { cloudinaryUrl } from '@/lib/cloudinary-url'
import { toISODate } from '@/lib/dates'
import { deleteReading, leaveCar, restoreReading } from '@/lib/db'
import { computeCostPerKm, computeFuelStats, fuelLabel, lastPrices } from '@/lib/fuel'
import { formatDate, formatKm, formatMoney, formatMoneyPrecise, formatNumber, timeAgo } from '@/lib/format'
import { describeRemaining, describeRuleInterval, MISSING_LAST_KM, missingLastKm, type RuleWithState } from '@/lib/maintenance'
import { readingOrigin } from '@/lib/odometer'
import { approvedJobs, authorLabel, canEditEntry, canWrite, carMembers, isCarOwner, isSharedCar } from '@/lib/sharing'
import { toast } from '@/lib/toast'
import { FUEL_LABELS, FUEL_UNITS, type Car, type FuelLoad, type Job, type MaintenanceRule, type OdometerReading } from '@/lib/types'
import { removeWithUndo, runInBackground } from '@/lib/use-saver'

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

/**
 * Recordatorios de una vez que ya cumplió un trabajo (`completedByJobId`), en una sección plegada. Cada uno lleva al
 * trabajo que lo cumplió (si la app no lo tiene, al recordatorio). Si se borra el trabajo, vuelve a estar activo.
 */
function CompletedRules({ car, completed, jobs }: { car: Car; completed: MaintenanceRule[]; jobs: Job[] }) {
  if (!completed.length) return null
  return (
    <details className="rounded-xl border border-white/8 bg-card/40 p-4">
      <summary className="cursor-pointer text-sm font-medium">Cumplidos ({completed.length})</summary>
      <div className="mt-3 divide-y divide-white/8">
        {completed.map(rule => {
          const job = jobs.find(j => j.id === rule.completedByJobId)
          return (
            <Link
              key={rule.id}
              href={job ? `/autos/${car.id}/trabajos/${job.id}` : `/autos/${car.id}/mantenimientos/${rule.id}`}
              className="flex items-center gap-3 py-2.5 text-sm transition hover:text-foreground"
            >
              <CalendarClock aria-hidden className="size-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{rule.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {job ? `Con el trabajo «${job.title}» del ${formatDate(job.date)}` : 'Cumplido con un trabajo'}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          )
        })}
      </div>
    </details>
  )
}

/**
 * Mantenimientos del auto: los activos y, plegados, los recordatorios cumplidos (`CompletedRules`). Agregarlos es sólo
 * del dueño: a un miembro no se le ofrece. Cada tarjeta lleva al mantenimiento (al dueño, a editarlo): si es por km y
 * le falta el km de la última vez, lo dice ahí.
 */
function RulesTab({
  car,
  rules,
  completed,
  jobs,
  owner,
}: {
  car: Car
  rules: RuleWithState[]
  completed: MaintenanceRule[]
  jobs: Job[]
  owner: boolean
}) {
  const done = <CompletedRules car={car} completed={completed} jobs={jobs} />
  if (!rules.length && !owner) {
    return (
      <div className="space-y-3">
        <EmptyState icon={Wrench} title="Sin mantenimientos" description="El dueño todavía no cargó mantenimientos para este auto." />
        {done}
      </div>
    )
  }
  if (!rules.length) {
    return (
      <div className="space-y-3">
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
        {done}
      </div>
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
              {missingLastKm(rule) && (
                <p className="text-warning sm:col-span-2">
                  {MISSING_LAST_KM}{owner ? ': tocá para completarlo.' : '.'}
                </p>
              )}
              {state.nextKm != null && (
                <p>
                  <span className="text-foreground">{r.km}</span> · a los {rule.lastDoneKmEstimated ? '≈ ' : ''}{formatKm(state.nextKm)}
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
      {done}
      {owner && (
        <LinkButton href={`/autos/${car.id}/mantenimientos/nuevo`} variant="ghost" className="w-full gap-2 text-muted-foreground">
          <Plus /> Agregar mantenimiento
        </LinkButton>
      )}
    </div>
  )
}

/**
 * Trabajos del auto: la lista muestra todos (los sin aprobar, con su etiqueta) y los totales suman sólo los aprobados.
 * Sin `writable` (soy `viewer`) no ofrece agregar.
 */
function JobsTab({ car, jobs, carById, writable }: { car: Car; jobs: Job[]; carById: Map<string, Car>; writable: boolean }) {
  const [exporting, setExporting] = useState(false)
  if (!jobs.length) {
    return (
      <EmptyState
        icon={Wrench}
        title="Sin trabajos registrados"
        description={writable ? 'Registrá lo que le hacés al auto y cuánto salió.' : undefined}
        action={
          writable ? (
            <LinkButton href={`/autos/${car.id}/trabajos/nuevo`} size="lg" className="gap-2">
              <Plus /> Agregar trabajo
            </LinkButton>
          ) : undefined
        }
      />
    )
  }
  const years = [...new Set(jobs.map(j => j.date.slice(0, 4)))]
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Total histórico: <span className="font-medium text-foreground">{formatMoney(approvedJobs(jobs).reduce((s, j) => s + j.cost, 0))}</span>
        </p>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setExporting(true)}>
          <FileText /> Exportar PDF
        </Button>
      </div>
      <ExportReportDialog car={car} open={exporting} onClose={() => setExporting(false)} />
      {years.map(y => {
        const ofYear = jobs.filter(j => j.date.startsWith(y))
        return (
          <section key={y}>
            <div className="mb-2 flex items-baseline justify-between text-sm">
              <h3 className="font-semibold">{y}</h3>
              <span className="tabular-nums text-muted-foreground">{formatMoney(approvedJobs(ofYear).reduce((s, j) => s + j.cost, 0))}</span>
            </div>
            <ActivityList items={mergeActivity(ofYear, [])} carById={carById} />
          </section>
        )
      })}
    </div>
  )
}

/** Cargas de combustible del auto. Sin `writable` (soy `viewer`) no ofrece agregar. */
function FuelTab({ car, fuel, carById, writable }: { car: Car; fuel: FuelLoad[]; carById: Map<string, Car>; writable: boolean }) {
  if (!fuel.length) {
    return (
      <EmptyState
        icon={Fuel}
        title="Sin cargas de combustible"
        description={
          writable ? `Registrá cada carga de ${car.fuelTypes.map(t => FUEL_LABELS[t]).join(' o ')} para ver consumo y costo por km.` : undefined
        }
        action={
          writable ? (
            <LinkButton href={`/autos/${car.id}/combustible/nuevo`} size="lg" className="gap-2">
              <Plus /> Agregar carga
            </LinkButton>
          ) : undefined
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

/**
 * Km del auto; en un auto compartido dice quién cargó cada registro. El de una carga o un trabajo dice de cuál
 * salió y lleva a él, y no se borra desde acá: se corrige editando o borrando ese registro. Los demás se pueden
 * borrar si los puedo editar (`canEditEntry`).
 */
function KmTab({ car, readings, fuel, jobs }: { car: Car; readings: OdometerReading[]; fuel: FuelLoad[]; jobs: Job[] }) {
  const { actor, uid, odometer } = useData()
  const confirm = useConfirm()
  const shared = isSharedCar(car, uid)

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
      remove: () => deleteReading(actor, car, odometer, r.id),
      restore: () => restoreReading(actor, car, odometer, r),
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
        {readings.map(r => {
          const origin = readingOrigin(r, fuel, jobs)
          const text = (
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium tabular-nums">{formatKm(r.km)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDate(toISODate(r.date))} · {origin?.label ?? SOURCE_LABELS[r.source]}
                {shared && ` · Cargado por ${authorLabel(r, car, uid)}`}
              </p>
            </div>
          )
          if (origin) {
            return (
              <Link key={r.id} href={origin.href} className="flex items-center gap-3 px-4 py-3 transition hover:bg-white/[0.03]">
                {text}
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            )
          }
          return (
            <div key={r.id} className="flex items-center gap-3 px-4 py-3">
              {text}
              {!r.sourceId && readings.length > 1 && canEditEntry(car, uid, r) && (
                <Button variant="ghost" size="icon-sm" aria-label={`Borrar el registro de ${formatKm(r.km)}`} className="text-muted-foreground hover:text-destructive" onClick={() => remove(r)}>
                  <Trash2 />
                </Button>
              )}
            </div>
          )
        })}
      </div>
      </section>
    </div>
  )
}

/**
 * Con quién está compartido el auto: al miembro, "Compartido por <dueño>" y "Salir de este auto"; al dueño de un
 * auto compartido, "Compartido con" y los nombres de los miembros (`memberProfiles`; si no tienen nombre, el mail).
 * En un auto sin compartir no muestra nada.
 */
function SharingBanner({ car, owner }: { car: Car; owner: boolean }) {
  const router = useRouter()
  const confirm = useConfirm()
  const { actor, email } = useData()
  const members = carMembers(car)
  const name = carName(car)

  async function leave() {
    const confirmed = await confirm({
      tone: 'danger',
      title: `¿Salir de ${name}?`,
      description: `Dejás de ver el auto. Lo que cargaste queda en el historial. Para volver, ${car.ownerName ?? 'el dueño'} te tiene que invitar de nuevo.`,
      confirmLabel: 'Sí, salir',
      icon: LogOut,
    })
    if (!confirmed) return
    router.replace('/')
    runInBackground(leaveCar(actor, car, email), `No se pudo salir de ${name}`)
    toast.success(`Saliste de ${name}`)
  }

  if (owner) {
    if (!members.length) return null
    return (
      <Link href={`/autos/${car.id}/editar`} className="flex items-center gap-3 rounded-xl border border-white/8 bg-card/60 px-4 py-3 text-sm hover:bg-card">
        <Users aria-hidden className="size-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate">
          Compartido con {members.map(m => m.name ?? m.email).join(' y ')}
        </span>
        <ChevronRight className="size-4 text-muted-foreground" />
      </Link>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-card/60 px-4 py-3">
      <Users aria-hidden className="size-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-sm">
        Compartido por <span className="font-medium">{car.ownerName ?? 'otra persona'}</span>
      </p>
      <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground hover:text-destructive" onClick={leave}>
        <LogOut /> Salir de este auto
      </Button>
    </div>
  )
}

/**
 * Cambia de pestaña con replaceState en vez de router.replace: es instantáneo y no le pide la página al servidor.
 * A un miembro no se le muestran "Editar auto" ni "Agregar mantenimiento": son del dueño.
 */
function CarDetail() {
  const { carId } = useParams<{ carId: string }>()
  const params = useSearchParams()
  const { carById, uid } = useData()
  const { car, rules, completed, jobs, fuel, readings } = useCar(carId)
  const [showKm, setShowKm] = useState(false)
  const tabParam = params.get('tab') as Tab | null
  const tab: Tab = tabParam && TABS.includes(tabParam) ? tabParam : 'estado'

  if (!car) return <NotFound what="el auto" />
  const owner = isCarOwner(car, uid)
  const writable = canWrite(car, uid)
  const quickActions = [
    ...(writable
      ? [
          { href: `/autos/${car.id}/trabajos/nuevo`, icon: Wrench, label: 'Trabajo' },
          { href: `/autos/${car.id}/combustible/nuevo`, icon: Fuel, label: 'Carga' },
        ]
      : []),
    ...(owner ? [{ href: `/autos/${car.id}/mantenimientos/nuevo`, icon: Plus, label: 'Mantenimiento' }] : []),
  ]

  return (
    <>
      <PageHeader
        back="/"
        title={carName(car)}
        subtitle={carDetail(car) || undefined}
        actions={
          owner ? (
            <LinkButton href={`/autos/${car.id}/editar`} variant="outline" size="icon" aria-label="Editar auto" className="size-9 border-white/10 bg-white/[0.03]">
              <Pencil />
            </LinkButton>
          ) : undefined
        }
      />
      <PageBody className="space-y-6">
        <SharingBanner car={car} owner={owner} />
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
            {writable && (
              <Button onClick={() => setShowKm(true)} className="h-10 gap-2 bg-foreground px-4 text-background hover:bg-foreground/90">
                <Gauge /> Cargar km
              </Button>
            )}
          </div>
          {quickActions.length > 0 && (
            <div className={`grid border-t border-white/8 ${quickActions.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {quickActions.map(({ href, icon: Icon, label }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex flex-col items-center gap-1.5 border-r border-white/8 py-3.5 text-xs text-muted-foreground transition last:border-r-0 hover:bg-white/[0.03] hover:text-foreground sm:flex-row sm:justify-center sm:text-sm"
                >
                  <Icon className="size-4 text-primary" />+ {label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <Tabs value={tab} onValueChange={v => window.history.replaceState(null, '', `?tab=${v}`)}>
          <TabsList className="h-10! w-full">
            <TabsTrigger value="estado">Estado</TabsTrigger>
            <TabsTrigger value="trabajos">Trabajos</TabsTrigger>
            <TabsTrigger value="combustible">Combustible</TabsTrigger>
            <TabsTrigger value="km">Km</TabsTrigger>
          </TabsList>
          <TabsContent value="estado" className="pt-4">
            <RulesTab car={car} rules={rules} completed={completed} jobs={jobs} owner={owner} />
          </TabsContent>
          <TabsContent value="trabajos" className="pt-4">
            <JobsTab car={car} jobs={jobs} carById={carById} writable={writable} />
          </TabsContent>
          <TabsContent value="combustible" className="pt-4">
            <FuelTab car={car} fuel={fuel} carById={carById} writable={writable} />
          </TabsContent>
          <TabsContent value="km" className="pt-4">
            <KmTab car={car} readings={readings} fuel={fuel} jobs={jobs} />
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
