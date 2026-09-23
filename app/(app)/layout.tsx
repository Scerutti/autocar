'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { BrandLogo } from '@/components/brand'
import { Loading } from '@/components/common'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/components/providers/auth-provider'
import { DataProvider, useData } from '@/components/providers/data-provider'
import { isFirebaseConfigured } from '@/lib/firebase/client'
import { errorMessage } from '@/lib/toast'
import { NotConfigured } from '@/components/not-configured'

const isPermissionDenied = (e: Error | null) => (e as { code?: string } | null)?.code === 'permission-denied'

/**
 * Primera vez que entra una cuenta: Firestore todavía no la conoce (no está en allowlist) y rechaza la
 * carga. Le pedimos al servidor que la registre y volvemos a cargar. Si falla otra vez no reintenta
 * solo, para no quedar en un bucle.
 */
function Join({ auto, onJoined }: { auto: boolean; onJoined: () => void }) {
  const { getToken, signOut } = useAuth()
  const [failure, setFailure] = useState<string | null>(auto ? null : 'No pudimos cargar tu cuenta.')
  const started = useRef(false)

  async function join() {
    setFailure(null)
    try {
      const res = await fetch('/api/access', { method: 'POST', headers: { Authorization: `Bearer ${await getToken()}` } })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'No pudimos preparar tu cuenta.')
      onJoined()
    } catch (e) {
      setFailure(errorMessage(e))
    }
  }

  useEffect(() => {
    // Una sola vez (en desarrollo React corre los efectos dos veces).
    if (!auto || started.current) return
    started.current = true
    void join()
  })

  if (failure == null) return <Loading label="Preparando tu cuenta…" />
  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-white/8 bg-card/60 p-8 text-center">
        <BrandLogo className="mx-auto w-32" />
        <h1 className="mt-6 text-xl font-semibold">No pudimos entrar</h1>
        <p className="mt-2 text-sm text-muted-foreground">{failure}</p>
        <Button onClick={() => void join()} size="lg" className="mt-6 h-11 w-full">
          Reintentar
        </Button>
        <Button onClick={() => void signOut()} variant="ghost" size="lg" className="mt-2 h-11 w-full">
          Salir
        </Button>
      </div>
    </div>
  )
}

function DataGate({ attempt, onRetry, children }: { attempt: number; onRetry: () => void; children: React.ReactNode }) {
  const { loading, error } = useData()
  if (isPermissionDenied(error)) return <Join auto={attempt === 0} onJoined={onRetry} />
  return (
    <AppShell>
      {error ? (
        <div className="mx-auto max-w-md p-8 text-center">
          <p className="font-medium">No se pudieron cargar tus datos</p>
          <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        </div>
      ) : loading ? (
        <Loading />
      ) : (
        children
      )}
    </AppShell>
  )
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  // Reintentos de carga por cuenta: cambiar la key vuelve a montar DataProvider (y a pedir los datos).
  const [retry, setRetry] = useState({ uid: '', attempt: 0 })

  useEffect(() => {
    if (isFirebaseConfigured && !loading && !user) {
      router.replace(pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`)
    }
  }, [loading, user, router, pathname])

  if (!isFirebaseConfigured) return <NotConfigured />
  if (loading || !user) return <Loading />

  const attempt = retry.uid === user.uid ? retry.attempt : 0
  return (
    <DataProvider key={`${user.uid}-${attempt}`}>
      <DataGate attempt={attempt} onRetry={() => setRetry({ uid: user.uid, attempt: attempt + 1 })}>
        {children}
      </DataGate>
    </DataProvider>
  )
}
