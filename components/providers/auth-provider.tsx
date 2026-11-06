'use client'

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { Loading } from '@/components/common'
import { useConfirm, type ConfirmOptions } from '@/components/confirm-provider'
import { firebaseAuth, isFirebaseConfigured, releaseFirestore } from '@/lib/firebase/client'
import { readOutbox } from '@/lib/outbox'
import { DEVICE_CHANNEL, FOLLOWER_RELOAD_MS, isSignOutMessage, unsavedChangesWarning } from '@/lib/sign-out'
import { clearDeviceData } from '@/lib/sign-out-client'
import { toast } from '@/lib/toast'

/** Opciones de `signOut`. */
export interface SignOutOptions {
  /** Sale sin preguntar nada, aunque haya cambios sin guardar (p. ej. después de borrar la cuenta). */
  skipConfirm?: boolean
  /** Confirmación de quien llama, cuando la bandeja no tiene cambios sin guardar (si tiene, se pregunta por ellos). */
  confirm?: ConfirmOptions
}

/**
 * `cancelled`: no confirmó. `signed-out`: salió y se borraron los datos del dispositivo. `cache-kept`: salió, pero
 * otra pestaña no soltó la caché de Firestore (ya se avisó con un toast que hay que cerrarla).
 */
export type SignOutResult = 'cancelled' | 'signed-out' | 'cache-kept'

interface AuthState {
  user: User | null
  loading: boolean
  /** Google con popup; donde no hay popups (algunas PWA instaladas en iOS) pasa a redirect. */
  signIn: () => Promise<void>
  /**
   * "Salir": si la bandeja tiene cambios sin guardar pide confirmación ("Tenés N cambios sin guardar…"), borra los
   * datos de la cuenta de este dispositivo (`clearDeviceData`) y cierra la sesión. Las otras pestañas se cierran solas.
   */
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>
  /** ID token para llamar a las API routes. */
  getToken: () => Promise<string>
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * Sesión de Firebase Auth. Mientras se cierra la sesión (en esta pestaña o en otra, por `DEVICE_CHANNEL`) muestra
 * "Cerrando sesión…" en lugar de la app, así no queda nada en pantalla de la cuenta que sale. La pestaña que no
 * inició la salida suelta Firestore y recarga en `/login` cuando la sesión se cierra (o a los `FOLLOWER_RELOAD_MS`).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)
  const [closing, setClosing] = useState(false)
  const confirm = useConfirm()
  const leading = useRef(false)
  const following = useRef(false)
  const closed = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured) return
    return onAuthStateChanged(firebaseAuth(), u => {
      if (!u && following.current) {
        window.location.replace('/login')
        return
      }
      setUser(u)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const channel = new BroadcastChannel(DEVICE_CHANNEL)
    channel.onmessage = event => {
      if (!isSignOutMessage(event.data) || leading.current || following.current) return
      following.current = true
      setClosing(true)
      window.setTimeout(() => window.location.reload(), FOLLOWER_RELOAD_MS)
    }
    return () => channel.close()
  }, [])

  useEffect(() => {
    if (!closing) return
    closed.current?.()
    closed.current = null
    if (following.current) void releaseFirestore(true).catch(e => console.warn('No se pudo cerrar Firestore', e))
  }, [closing])

  async function signIn() {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    try {
      await signInWithPopup(firebaseAuth(), provider)
    } catch (e) {
      const code = (e as { code?: string }).code
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(firebaseAuth(), provider)
        return
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return
      throw e
    }
  }

  async function signOut({ skipConfirm = false, confirm: ask }: SignOutOptions = {}): Promise<SignOutResult> {
    if (leading.current) return 'cancelled'
    const uid = user?.uid
    if (!skipConfirm) {
      const warning = uid ? unsavedChangesWarning(readOutbox(uid).length) : null
      const options: ConfirmOptions | undefined = warning ? { ...warning, tone: 'danger', icon: LogOut } : ask
      if (options && !(await confirm(options))) return 'cancelled'
    }
    leading.current = true
    try {
      await new Promise<void>(resolve => {
        closed.current = resolve
        setClosing(true)
      })
      const cleared = uid ? await clearDeviceData(uid) : true
      await fbSignOut(firebaseAuth())
      setUser(null)
      if (cleared) return 'signed-out'
      toast.warning('Cerraste sesión', {
        description: 'Cerrá las otras pestañas de AutoCar para terminar de borrar los datos de este dispositivo.',
        timeout: 0,
      })
      return 'cache-kept'
    } finally {
      leading.current = false
      setClosing(false)
    }
  }

  const value: AuthState = {
    user,
    loading,
    signIn,
    signOut,
    getToken: async () => {
      if (!user) throw new Error('No hay sesión')
      return user.getIdToken()
    },
  }

  return <AuthContext value={value}>{closing ? <Loading label="Cerrando sesión…" /> : children}</AuthContext>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
