'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Bell, Fuel, Wrench } from 'lucide-react'
import { BrandLogo } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form'
import { Loading } from '@/components/common'
import { NotConfigured } from '@/components/not-configured'
import { useAuth } from '@/components/providers/auth-provider'
import { isFirebaseConfigured } from '@/lib/firebase/client'

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15A10.96 10.96 0 0 0 12 1 11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38z" />
    </svg>
  )
}

function LoginInner() {
  const { user, loading, signIn } = useAuth()
  const router = useRouter()
  const next = useSearchParams().get('next')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Sólo rutas internas, para no redirigir a otro sitio.
    if (user) router.replace(next?.startsWith('/') && !next.startsWith('//') ? next : '/')
  }, [user, next, router])

  if (loading || user) return <Loading />

  async function handleSignIn() {
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1>
          <BrandLogo className="w-52" />
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">El mantenimiento de tus autos al día, sin sorpresas.</p>
        <ul className="mt-8 space-y-3 text-sm text-muted-foreground">
          <li className="flex items-center gap-3"><Wrench className="size-4 text-primary" /> Services y vencimientos por km o por fecha</li>
          <li className="flex items-center gap-3"><Bell className="size-4 text-primary" /> Recordatorio semanal para cargar los km</li>
          <li className="flex items-center gap-3"><Fuel className="size-4 text-primary" /> Trabajos, cargas de combustible y gastos</li>
        </ul>
        <Button onClick={handleSignIn} disabled={busy} className="mt-10 h-11 w-full gap-2 bg-foreground text-background hover:bg-foreground/90">
          <GoogleIcon /> {busy ? 'Entrando…' : 'Entrar con Google'}
        </Button>
        <FormError className="mt-3">{error}</FormError>
      </div>
    </div>
  )
}

export default function LoginPage() {
  if (!isFirebaseConfigured) return <NotConfigured />
  return (
    <Suspense fallback={<Loading />}>
      <LoginInner />
    </Suspense>
  )
}
