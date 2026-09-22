'use client'

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CarFront, ChevronRight, Plus } from 'lucide-react'
import { ActivityList, mergeActivity } from '@/components/activity'
import { CarCard } from '@/components/car-card'
import { BrandMark } from '@/components/brand'
import { EmptyState, LinkButton, PageBody, PageHeader, SectionTitle, StatusBadge, carName } from '@/components/common'
import { KmDialog } from '@/components/km-form'
import { useAuth } from '@/components/providers/auth-provider'
import { useData } from '@/components/providers/data-provider'
import { formatToday } from '@/lib/format'
import { describeRemaining } from '@/lib/maintenance'

function greeting() {
  const h = new Date().getHours()
  return h < 6 ? 'Buenas noches' : h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches'
}

export default function HomePage() {
  const { user } = useAuth()
  const { cars, rulesByCar, jobs, fuel, carById } = useData()
  const [kmCarId, setKmCarId] = useState<string | null>(null)
  const kmCar = kmCarId ? carById.get(kmCarId) : null

  const alerts = cars.flatMap(car =>
    (rulesByCar.get(car.id) ?? [])
      .filter(r => r.state.status === 'overdue' || r.state.status === 'soon')
      .map(r => ({ car, ...r })),
  )
  const activity = mergeActivity(jobs, fuel).slice(0, 6)
  const firstName = user?.displayName?.split(' ')[0]

  return (
    <>
      <PageHeader
        eyebrow={formatToday()}
        title={`${greeting()}${firstName ? `, ${firstName}` : ''}`}
        leading={<BrandMark className="size-11 lg:hidden" />}
        actions={
          <LinkButton href="/autos/nuevo" aria-label="Agregar auto" size="icon" className="size-9">
            <Plus />
          </LinkButton>
        }
      />
      <PageBody>
        {cars.length === 0 ? (
          <EmptyState
            icon={CarFront}
            title="Todavía no agregaste ningún auto"
            description="Cargá tu auto con los km actuales y después sumale los mantenimientos (service, VTV, seguro…)."
            action={
              <LinkButton href="/autos/nuevo" size="lg" className="gap-2">
                <Plus /> Agregar auto
              </LinkButton>
            }
          />
        ) : (
          <>
            <SectionTitle
              title="Tus autos"
              subtitle={alerts.length ? `${alerts.length} ${alerts.length === 1 ? 'cosa para revisar' : 'cosas para revisar'}.` : 'Todo bajo control, sin sorpresas.'}
            />
            <div className="grid gap-5 xl:grid-cols-2">
              {cars.map((car, i) => (
                <CarCard key={car.id} car={car} index={i} rules={rulesByCar.get(car.id) ?? []} onUpdateKm={() => setKmCarId(car.id)} />
              ))}
            </div>

            {alerts.length > 0 && (
              <section className="mt-10">
                <SectionTitle title="Para revisar" subtitle="Mantenimientos vencidos o por vencer." />
                <div className="divide-y divide-white/8 overflow-hidden rounded-xl border border-white/8 bg-card/60">
                  {alerts.map(({ car, rule, state }) => {
                    const r = describeRemaining(state)
                    return (
                      <Link
                        key={rule.id}
                        href={`/autos/${car.id}/mantenimientos/${rule.id}`}
                        className="flex items-center gap-3 px-4 py-4 hover:bg-white/[0.02] sm:px-5"
                      >
                        <div
                          className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${state.status === 'overdue' ? 'bg-destructive/10 text-destructive' : 'bg-warning/10 text-warning'}`}
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
                  })}
                </div>
              </section>
            )}

            <section className="mt-10">
              <SectionTitle
                title="Actividad reciente"
                subtitle="Últimos trabajos y cargas."
                action={
                  <Link href="/trabajos" className="flex items-center gap-1 text-sm text-primary hover:underline">
                    Ver todos <ChevronRight className="size-4" />
                  </Link>
                }
              />
              {activity.length ? (
                <ActivityList items={activity} carById={carById} showCar={cars.length > 1} />
              ) : (
                <p className="rounded-xl border border-dashed border-white/10 p-5 text-sm text-muted-foreground">
                  Cuando registres un trabajo o una carga de combustible va a aparecer acá.
                </p>
              )}
            </section>
          </>
        )}
      </PageBody>
      <KmDialog car={kmCar ?? null} onClose={() => setKmCarId(null)} />
    </>
  )
}
