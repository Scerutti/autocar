'use client'

import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { describeProgress, latestAchievement, nextAchievement } from '@/lib/achievements'
import { ProgressBar } from './achievement-parts'
import { useAchievements } from './achievements-provider'
import { Medal } from './medal'

const RECENT_MS = 7 * 86_400_000

/**
 * Tarjeta chica para el inicio: cuántos logros hay, el último (si es de esta semana) o el próximo
 * alcanzable. No compite con los autos ni con los mantenimientos.
 */
export function AchievementsCard() {
  const { statuses, unlocked, total } = useAchievements()
  const latest = latestAchievement(statuses)
  const next = nextAchievement(statuses)
  const recent = latest && Date.now() - latest.record!.unlockedAt.getTime() < RECENT_MS ? latest : null
  const shown = recent ?? next ?? latest

  return (
    <Link
      href="/logros"
      className="flex items-center gap-4 rounded-xl border border-white/8 bg-card/60 p-4 transition hover:bg-card"
    >
      {shown && <Medal id={shown.def.id} category={shown.def.category} state={shown.state} className="size-12" />}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold">Logros</p>
          <p className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {unlocked} de {total}
          </p>
        </div>
        <ProgressBar value={unlocked} max={total} className="mt-2" />
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {unlocked === 0 && next ? (
            <>
              Tu primer logro te espera: <span className="text-foreground">{next.def.name}</span>
            </>
          ) : recent ? (
            <>
              Nuevo: <span className="text-foreground">{recent.def.name}</span>
            </>
          ) : next ? (
            <>
              Próximo: <span className="text-foreground">{next.def.name}</span> · {describeProgress(next.def, next.progress)}
            </>
          ) : (
            '¡Los conseguiste todos!'
          )}
        </p>
      </div>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
    </Link>
  )
}
