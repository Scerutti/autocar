'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Wallet } from 'lucide-react'
import { CarFilter } from '@/components/car-filter'
import { CategoryBars, ChartCard, Legend, MonthlyBars } from '@/components/charts'
import { EmptyState, Loading, PageBody, PageHeader } from '@/components/common'
import { Select } from '@/components/ui/select'
import { useData } from '@/components/providers/data-provider'
import { expenseYears, summarizeExpenses } from '@/lib/expenses'
import { computeCostPerKm } from '@/lib/fuel'
import { formatMoney, formatMoneyPrecise } from '@/lib/format'
import { JOB_CATEGORY_LABELS } from '@/lib/types'

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-card/60 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums tracking-tight sm:text-2xl">{value}</p>
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

  const carJobs = carId === 'all' ? jobs : jobs.filter(j => j.carId === carId)
  const carFuel = carId === 'all' ? fuel : fuel.filter(f => f.carId === carId)
  const years = expenseYears(carJobs, carFuel, now.getFullYear())
  const s = summarizeExpenses(carJobs, carFuel, year, now)
  const costPerKm = carId !== 'all' ? computeCostPerKm(carFuel) : null

  return (
    <>
      <PageHeader
        title="Gastos"
        subtitle="Trabajos y combustible."
        actions={
          <Select value={year} onChange={setYear} items={years.map(y => ({ value: y, label: String(y) }))} className="h-10 w-28" aria-label="Año" />
        }
      />
      <PageBody className="space-y-6">
        <CarFilter cars={cars} value={carId} onChange={setCarId} />

        {s.total === 0 ? (
          <EmptyState icon={Wallet} title={`Sin gastos en ${year}`} description="Registrá trabajos y cargas de combustible para ver el resumen." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label={`Total ${year}`} value={formatMoney(s.total)} />
              <Tile label="Promedio mensual" value={formatMoney(s.monthlyAverage)} />
              <Tile label="Trabajos" value={formatMoney(s.jobsTotal)} hint={`${s.total ? Math.round((s.jobsTotal / s.total) * 100) : 0}% del total`} />
              <Tile
                label="Combustible"
                value={formatMoney(s.fuelTotal)}
                hint={costPerKm != null ? `${formatMoneyPrecise(costPerKm)} por km` : `${s.total ? Math.round((s.fuelTotal / s.total) * 100) : 0}% del total`}
              />
            </div>

            <ChartCard
              title={`¿Cuánto gastaste cada mes de ${year}?`}
              description="Cada barra es un mes: en azul lo que gastaste en trabajos y en naranja en combustible. Tocá una barra para ver el detalle."
              legend={
                <Legend
                  items={[
                    { label: 'Trabajos', color: 'var(--series-1)' },
                    { label: 'Combustible', color: 'var(--series-2)' },
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
