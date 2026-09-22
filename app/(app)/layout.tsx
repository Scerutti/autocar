'use client'

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { AppShell } from '@/components/app-shell'
import { Loading } from '@/components/common'
import { useAuth } from '@/components/providers/auth-provider'
import { DataProvider, useData } from '@/components/providers/data-provider'
import { isFirebaseConfigured } from '@/lib/firebase/client'
import { NotConfigured } from '@/components/not-configured'

function DataGate({ children }: { children: React.ReactNode }) {
  const { loading, error } = useData()
  if (error) {
    return (
      <div className="mx-auto max-w-md p-8 text-center">
        <p className="font-medium">No se pudieron cargar tus datos</p>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
      </div>
    )
  }
  return loading ? <Loading /> : children
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (isFirebaseConfigured && !loading && !user) {
      router.replace(pathname === '/' ? '/login' : `/login?next=${encodeURIComponent(pathname)}`)
    }
  }, [loading, user, router, pathname])

  if (!isFirebaseConfigured) return <NotConfigured />
  if (loading || !user) return <Loading />

  return (
    <DataProvider>
      <AppShell>
        <DataGate>{children}</DataGate>
      </AppShell>
    </DataProvider>
  )
}
