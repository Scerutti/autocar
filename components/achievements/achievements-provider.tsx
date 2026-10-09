'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useData } from '@/components/providers/data-provider'
import {
  ACHIEVEMENTS,
  carRecords,
  evaluateAchievements,
  pendingCelebrations,
  pendingUnlocks,
  type AchievementStatus,
} from '@/lib/achievements'
import { markAchievementsCelebrated, unlockAchievements } from '@/lib/db'
import type { AchievementRecord } from '@/lib/types'
import { CelebrationDialog } from './celebration-dialog'

interface AchievementsState {
  statuses: AchievementStatus[]
  unlocked: number
  total: number
}

const AchievementsContext = createContext<AchievementsState | null>(null)

/** Espera a que lleguen todos los cambios de una misma operación (un trabajo toca trabajos, mantenimientos y km). */
const SETTLE_MS = 800
const RETRY_MS = [5_000, 30_000, 120_000, 300_000]

/**
 * Desbloquea los logros que se cumplen con los datos ya guardados en Firestore (no con lo que hay
 * en un formulario). Corre después de cualquier cambio, así cubre km, trabajos, cargas y
 * mantenimientos sin tocar cada formulario. Sin conexión no lo intenta: espera a que vuelva la señal.
 */
function useAutoUnlock(uid: string, statuses: AchievementStatus[]) {
  const unlocks = useMemo(() => pendingUnlocks(statuses), [statuses])
  const key = unlocks.map(u => u.id).join(',')
  const latest = useRef(unlocks)
  latest.current = unlocks
  const running = useRef(false)
  const failures = useRef(0)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    const online = () => setRetry(n => n + 1)
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [])

  useEffect(() => {
    if (!key) return
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const timer = setTimeout(() => {
      // Si ya hay una transacción en curso, cuando termine cambia `key` y esto vuelve a correr.
      if (running.current || !navigator.onLine) return
      running.current = true
      unlockAchievements(uid, latest.current)
        .then(() => {
          failures.current = 0
        })
        .catch(() => {
          const delay = RETRY_MS[Math.min(failures.current, RETRY_MS.length - 1)]
          failures.current++
          retryTimer = setTimeout(() => setRetry(n => n + 1), delay)
        })
        .finally(() => {
          running.current = false
        })
    }, SETTLE_MS)
    return () => {
      clearTimeout(timer)
      clearTimeout(retryTimer)
    }
  }, [key, uid, retry])
}

const OPEN_DELAY_MS = 900

/**
 * Muestra las celebraciones pendientes de a una tanda: las que estaban pendientes cuando se abre.
 * Lo que se desbloquee mientras está abierta queda para la tanda siguiente (nunca dos ventanas a la vez).
 */
function CelebrationHost({ statuses }: { statuses: AchievementStatus[] }) {
  const { uid, achievements, cars } = useData()
  // Lo ya marcado como visto en esta sesión, por si la escritura todavía no volvió en el snapshot.
  const seen = useRef(new Set<string>())
  const pending = useMemo(() => pendingCelebrations(achievements).filter(r => !seen.current.has(r.id)), [achievements])
  const [queue, setQueue] = useState<AchievementRecord[] | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (queue || !pending.length) return
    const t = setTimeout(() => {
      setQueue(pending)
      setOpen(true)
    }, OPEN_DELAY_MS)
    return () => clearTimeout(t)
  }, [pending, queue])

  const markSeen = useCallback(
    (ids: string[]) => {
      const fresh = ids.filter(id => !seen.current.has(id))
      if (!fresh.length) return
      fresh.forEach(id => seen.current.add(id))
      // Sin señal queda en la caché local y se sincroniza después; si falla, vuelve a aparecer la próxima vez.
      markAchievementsCelebrated(uid, fresh).catch(() => fresh.forEach(id => seen.current.delete(id)))
    },
    [uid],
  )

  if (!queue) return null
  const byId = new Map(statuses.map(s => [s.def.id, s]))
  return (
    <CelebrationDialog
      open={open}
      items={queue.map(r => byId.get(r.id)!).filter(Boolean)}
      carById={cars.length > 1 ? new Map(cars.map(c => [c.id, c])) : null}
      onSeen={markSeen}
      onClose={() => {
        markSeen(queue.map(r => r.id))
        setOpen(false)
      }}
      onClosed={() => setQueue(null)}
    />
  )
}

export function AchievementsProvider({ children }: { children: React.ReactNode }) {
  const { uid, cars, rules, jobs, fuel, odometer, achievements, today } = useData()
  const statuses = useMemo(
    () => evaluateAchievements(carRecords({ cars, rules, jobs, fuel, odometer }, today), achievements, today),
    [cars, rules, jobs, fuel, odometer, achievements, today],
  )
  useAutoUnlock(uid, statuses)

  const value = useMemo<AchievementsState>(
    () => ({ statuses, unlocked: statuses.filter(s => s.record).length, total: ACHIEVEMENTS.length }),
    [statuses],
  )

  return (
    <AchievementsContext value={value}>
      {children}
      <CelebrationHost statuses={statuses} />
    </AchievementsContext>
  )
}

export function useAchievements() {
  const ctx = useContext(AchievementsContext)
  if (!ctx) throw new Error('useAchievements fuera de AchievementsProvider')
  return ctx
}
