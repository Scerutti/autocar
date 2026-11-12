'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { CarFilter } from '@/components/car-filter'
import { CategoryBars, ChartCard, Legend, MonthlyBars } from '@/components/charts'
import { EmptyState, Loading, PageBody, PageHeader } from '@/components/common'
import { PendingBell } from '@/components/pending/pending-bell'
import { Select } from '@/components/ui/select'
import { useData } from '@/components/providers/data-provider'
import { expenseYears, percentShares, summarizeExpenses } from '@/lib/expenses'
import { computeCostPerKm } from '@/lib/fuel'
import { formatMoney, formatMoneyPrecise } from '@/lib/format'
import { approvedJobs } from '@/lib/sharing'
import { JOB_CATEGORY_LABELS } from '@/lib/types'
import { cn } from '@/lib/utils'

function Tile({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className={cn('rounded-md border border-line bg-card/60 p-4', className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold leading-tight tabular-nums sm:text-3xl">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Expenses() {
  const { cars, jobs, fuel, carById } = useData()
  const initialCar = useSearchParams().get('auto')
  const [carId, setCarId] = useState(initialCar && carById.has(initialCar) ? initialCar : 'all')
  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())

  const carJobs = approvedJobs(carId === 'all' ? jobs : jobs.filter(j => j.carId === carId))
  const carFuel = carId === 'all' ? fuel : fuel.filter(f => f.carId === carId)
  const years = expenseYears(carJobs, carFuel, now.getFullYear())
  const s = summarizeExpenses(carJobs, carFuel, year, now)
  const costPerKm = carId !== 'all' ? computeCostPerKm(carFuel) : null
  const [jobsShare, partsShare, fuelShare] = percentShares([s.jobsTotal, s.partsTotal, s.fuelTotal]).map(p => `${p}% del total`)

  return (
    <>
      <PageHeader
        title="Gastos"
        subtitle="Trabajos, repuestos y combustible."
        actions={
          <>
            <Select value={year} onChange={setYear} items={years.map(y => ({ value: y, label: String(y) }))} className="h-10 w-28" aria-label="Año" />
            <PendingBell />
          </>
        }
      />
      <PageBody className="space-y-6">
        <CarFilter cars={cars} value={carId} onChange={setCarId} />

        {s.total === 0 ? (
          <EmptyState icon={Wallet} title={`Sin gastos en ${year}`} description="Registrá trabajos y cargas de combustible para ver el resumen." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <Tile label={`Total ${year}`} value={formatMoney(s.total)} className="col-span-2 lg:col-span-1" />
              <Tile label="Promedio mensual" value={formatMoney(s.monthlyAverage)} />
              <Tile label="Trabajos" value={formatMoney(s.jobsTotal)} hint={jobsShare} />
              <Tile label="Repuestos" value={formatMoney(s.partsTotal)} hint={partsShare} />
              <Tile
                label="Combustible"
                value={formatMoney(s.fuelTotal)}
                hint={costPerKm != null ? `${fuelShare} · ${formatMoneyPrecise(costPerKm)} por km` : fuelShare}
              />
            </div>

            <ChartCard
              title={`¿Cuánto gastaste cada mes de ${year}?`}
              description="Cada barra es un mes: en azul lo que gastaste en trabajos, en naranja en combustible y en verde en repuestos. Tocá una barra para ver el detalle."
              legend={
                <Legend
                  items={[
                    { label: 'Trabajos', color: 'var(--series-1)' },
                    { label: 'Combustible', color: 'var(--series-2)' },
                    { label: 'Repuestos', color: 'var(--series-3)' },
                  ]}
                />
              }
            >
              <MonthlyBars key={`${carId}-${year}`} months={s.months} currentMonth={year === now.getFullYear() ? now.getMonth() : null} />
            </ChartCard>

            <ChartCard title="¿En qué se fue la plata?" description={`Lo que gastaste en ${year} según el tipo de gasto, de mayor a menor.`}>
              <CategoryBars
                rows={s.byCategory.map(c => ({
                  label: c.category === 'combustible' ? 'Combustible' : JOB_CATEGORY_LABELS[c.category],
                  value: c.total,
                }))}
              />
            </ChartCard>
          </>
        )}
      </PageBody>
    </>
  )
}

export default function ExpensesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Expenses />
    </Suspense>
  )
}
