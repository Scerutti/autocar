'use client'

import { useState } from 'react'
import { CarFront, CircleCheck, Info, Lock, Plus, Trophy } from 'lucide-react'
import { ProgressBar, ProgressRing } from '@/components/achievements/achievement-parts'
import { useAchievements } from '@/components/achievements/achievements-provider'
import { Medal } from '@/components/achievements/medal'
import { EmptyState, LinkButton, PageBody, PageHeader, carName } from '@/components/common'
import { useData } from '@/components/providers/data-provider'
import { Segmented } from '@/components/ui/choice'
import {
  ACHIEVEMENT_CATEGORIES,
  describeProgress,
  latestAchievement,
  nextAchievement,
  type AchievementStatus,
} from '@/lib/achievements'
import { toISODate } from '@/lib/dates'
import { formatDate } from '@/lib/format'
import type { Car } from '@/lib/types'
import { cn } from '@/lib/utils'

type Filter = 'all' | 'unlocked' | 'pending'

const FILTERS = [
  { value: 'all' as const, label: 'Todos' },
  { value: 'unlocked' as const, label: 'Desbloqueados' },
  { value: 'pending' as const, label: 'Pendientes' },
]

function AchievementTile({ status, car }: { status: AchievementStatus; car: Car | null }) {
  const { def, record, progress, state } = status
  const label = describeProgress(def, progress)
  return (
    <article
      className={cn(
        'flex flex-col items-center rounded-2xl border p-3.5 text-center sm:p-4',
        state === 'unlocked' ? 'border-amber-300/15 bg-card/80' : 'border-white/8 bg-card/40',
      )}
    >
      <Medal id={def.id} category={def.category} state={state} className="size-16 sm:size-[4.5rem]" />
      <h3 className={cn('mt-3 text-sm font-semibold leading-tight', state !== 'unlocked' && 'text-foreground/85')}>
        {def.name}
        {def.milestone && <span className="sr-only"> (hito)</span>}
      </h3>
      <p className="mt-1 text-xs leading-snug text-muted-foreground">{def.description}</p>

      <div className="mt-auto w-full pt-3">
        {state === 'unlocked' ? (
          <>
            <p className="flex items-center justify-center gap-1 text-xs font-medium text-success">
              <CircleCheck aria-hidden className="size-3.5 shrink-0" />
              Desbloqueado
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatDate(toISODate(record!.unlockedAt))}
              {car && ` · ${carName(car)}`}
            </p>
          </>
        ) : state === 'in-progress' ? (
          <>
            <ProgressBar value={progress.current} max={progress.target} />
            <p className="mt-1.5 text-xs font-medium tabular-nums text-foreground/85">
              <span className="sr-only">En progreso: </span>
              {label}
            </p>
            {progress.hint && progress.hint !== label && <p className="mt-0.5 text-[11px] text-muted-foreground">{progress.hint}</p>}
          </>
        ) : (
          <>
            <p className="flex items-center justify-center gap-1 text-xs font-medium text-muted-foreground">
              <Lock aria-hidden className="size-3.5 shrink-0" />
              Pendiente
            </p>
            {progress.hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{progress.hint}</p>}
          </>
        )}
      </div>
    </article>
  )
}

export default function AchievementsPage() {
  const { cars, carById } = useData()
  const { statuses, unlocked, total } = useAchievements()
  const [filter, setFilter] = useState<Filter>('all')

  const latest = latestAchievement(statuses)
  const next = nextAchievement(statuses)
  const visible = statuses.filter(s => (filter === 'all' ? true : filter === 'unlocked' ? Boolean(s.record) : !s.record))
  const carOf = (s: AchievementStatus) => (cars.length > 1 && s.carId ? (carById.get(s.carId) ?? null) : null)

  return (
    <>
      <PageHeader title="Logros" subtitle="Pequeños logros, grandes cuidados." />
      <PageBody className="space-y-8">
        {cars.length === 0 && unlocked === 0 ? (
          <EmptyState
            icon={CarFront}
            title="Agregá tu auto para empezar"
            description="Los logros se consiguen usando AutoCar: cargando los km, los trabajos y las cargas de combustible."
            action={
              <LinkButton href="/autos/nuevo" size="lg" className="gap-2">
                <Plus /> Agregar auto
              </LinkButton>
            }
          />
        ) : (
          <>
            <section aria-label="Progreso general" className="flex items-center gap-4 rounded-2xl border border-white/8 bg-card/60 p-4 sm:gap-6 sm:p-5">
              <ProgressRing value={unlocked} total={total} className="size-24 sm:size-28" />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {unlocked === 0 ? 'Todavía no conseguiste ninguno' : unlocked === total ? '¡Los conseguiste todos!' : `${unlocked} de ${total} logros desbloqueados`}
                </p>
                <dl className="mt-2 space-y-1 text-sm">
                  {latest && (
                    <div className="flex min-w-0 gap-1.5">
                      <dt className="shrink-0 text-muted-foreground">Último:</dt>
                      <dd className="truncate">{latest.def.name}</dd>
                    </div>
                  )}
                  {next && (
                    <div className="flex min-w-0 gap-1.5">
                      <dt className="shrink-0 text-muted-foreground">Próximo:</dt>
                      <dd className="truncate">
                        {next.def.name}
                        <span className="text-muted-foreground"> · {describeProgress(next.def, next.progress)}</span>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            </section>

            {/* En celulares angostos achica la letra para que "Desbloqueados" entre sin desbordar. */}
            <Segmented
              value={filter}
              onChange={setFilter}
              options={FILTERS}
              aria-label="Mostrar"
              className="sm:max-w-md [&>*]:px-1 [&>*]:text-xs min-[400px]:[&>*]:text-sm"
            />

            {ACHIEVEMENT_CATEGORIES.map(cat => {
              const items = visible.filter(s => s.def.category === cat.id)
              if (!items.length) return null
              const done = statuses.filter(s => s.def.category === cat.id && s.record).length
              const all = statuses.filter(s => s.def.category === cat.id).length
              return (
                <section key={cat.id} aria-labelledby={`cat-${cat.id}`}>
                  <div className="mb-3 flex items-end justify-between gap-3">
                    <div className="min-w-0">
                      <h2 id={`cat-${cat.id}`} className="text-lg font-semibold">
                        {cat.label}
                      </h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">{cat.description}</p>
                    </div>
                    <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                      {done}/{all}
                    </span>
                  </div>
                  {cat.id === 'constancia' && (
                    <p className="mb-3 flex items-start gap-2 rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2.5 text-xs text-muted-foreground">
                      <Info aria-hidden className="mt-px size-3.5 shrink-0 text-primary" />
                      <span>
                        Cada semana va de lunes a domingo y alcanza con un registro de km (el recordatorio semanal te avisa). Si una semana queda sin
                        registro, la racha vuelve a empezar, pero los logros que ya tenés no se pierden.
                      </span>
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
                    {items.map(s => (
                      <AchievementTile key={s.def.id} status={s} car={carOf(s)} />
                    ))}
                  </div>
                </section>
              )
            })}

            {visible.length === 0 && (
              <EmptyState
                icon={Trophy}
                title={filter === 'unlocked' ? 'Todavía no desbloqueaste ninguno' : 'No te queda ninguno pendiente'}
                description={filter === 'unlocked' ? 'Empezá cargando los km de hoy: es el primero.' : '¡Felicitaciones, los tenés todos!'}
              />
            )}

            <p className="flex items-start gap-2 rounded-xl border border-success/15 bg-success/5 px-3.5 py-3 text-xs text-muted-foreground">
              <CircleCheck aria-hidden className="mt-px size-4 shrink-0 text-success" />
              <span>
                Los logros son permanentes: no se pierden ni se repiten si después editás o borrás registros. Premian la constancia al anotar, no
                gastar más ni usar más el auto.
              </span>
            </p>
          </>
        )}
      </PageBody>
    </>
  )
}
