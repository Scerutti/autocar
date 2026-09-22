'use client'

import { useEffect } from 'react'
import { Toaster } from '@/components/ui/toaster'
import { registerServiceWorker } from '@/lib/push-client'
import { toast } from '@/lib/toast'
import { AuthProvider } from './auth-provider'

/** Avisa cuando se corta la conexión (la app sigue funcionando con la caché de Firestore). */
function useNetworkStatusToasts() {
  useEffect(() => {
    const offline = () =>
      toast.warning('Sin conexión', {
        id: 'network',
        timeout: 0,
        description: 'Podés seguir usando la app: los cambios se sincronizan cuando vuelva la señal.',
      })
    const online = () => toast.success('Conexión restablecida', { id: 'network' })
    if (!navigator.onLine) offline()
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => {
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', online)
    }
  }, [])
}

export function Providers({ children }: { children: React.ReactNode }) {
  useNetworkStatusToasts()
  useEffect(() => {
    void registerServiceWorker()
  }, [])
  return (
    <AuthProvider>
      {children}
      <Toaster />
    </AuthProvider>
  )
}
