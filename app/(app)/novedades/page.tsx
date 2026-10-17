'use client'

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { PageBody, PageHeader } from '@/components/common'
import { useNovedades } from '@/components/novedades/use-novedades'
import { formatDate } from '@/lib/format'
import { NOVEDADES } from '@/lib/novedades'

/** Lo nuevo de cada versión. Entrar marca todo como visto; lo que era nuevo queda resaltado mientras se está acá. */
export default function NovedadesPage() {
  const { unseen, markSeen, ready } = useNovedades()
  const [fresh, setFresh] = useState<Set<string> | null>(null)

  useEffect(() => {
    if (!ready || fresh) return
    setFresh(new Set(unseen.map(n => n.version)))
    markSeen()
  }, [ready, fresh, unseen, markSeen])

  return (
    <>
      <PageHeader back title="Novedades" subtitle="Qué hay de nuevo en la app." />
      <PageBody className="mx-auto max-w-2xl space-y-5">
        {NOVEDADES.map(n => (
          <section key={n.version} className="rounded-2xl border border-white/8 bg-card/60 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">Versión {n.version}</h2>
              {fresh?.has(n.version) && (
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary">
                  <Sparkles className="size-3" /> Nuevo
                </span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">{formatDate(n.date)}</span>
            </div>
            <ul className="mt-4 space-y-3">
              {n.items.map(item => (
                <li key={item.title} className="text-sm">
                  <p className="font-medium">{item.title}</p>
                  <p className="mt-0.5 text-muted-foreground">{item.text}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </PageBody>
    </>
  )
}
