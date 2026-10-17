'use client'

import { useCallback, useMemo } from 'react'
import { useAuth } from '@/components/providers/auth-provider'
import { toISODate } from '@/lib/dates'
import { useLocalValue, writeLocal } from '@/lib/local-store'
import { NOVEDADES, SEEN_KEY, unseenNovedades } from '@/lib/novedades'

/**
 * Novedades sin ver en este dispositivo y cómo marcarlas como vistas. Mientras no se sabe qué hay guardado
 * (servidor e hidratación) no hay nada sin ver, para que el aviso no parpadee.
 */
export function useNovedades() {
  const { user } = useAuth()
  const seen = useLocalValue(SEEN_KEY)
  const creationTime = user?.metadata.creationTime
  const unseen = useMemo(() => {
    if (seen === undefined) return []
    const created = creationTime ? new Date(creationTime) : null
    return unseenNovedades(seen, created && !Number.isNaN(created.getTime()) ? toISODate(created) : null)
  }, [seen, creationTime])
  const markSeen = useCallback(() => writeLocal(SEEN_KEY, NOVEDADES[0].version), [])
  return { unseen, markSeen, ready: seen !== undefined }
}
