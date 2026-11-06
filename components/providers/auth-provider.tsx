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
import { useConfirm, useDismissConfirm, type ConfirmOptions } from '@/components/confirm-provider'
import { waitForServerWrites } from '@/lib/db'
import { firebaseAuth, isFirebaseConfigured, releaseFirestore } from '@/lib/firebase/client'
import { readOutbox } from '@/lib/outbox'
import {
  DEVICE_CHANNEL,
  FOLLOWER_RELOAD_MS,
  PENDING_WRITES_WAIT_MS,
  followsSignOut,
  leavesOnSignedOut,
  settleWithin,
  signOutWarning,
  unsavedOutbox,
} from '@/lib/sign-out'
import { TAB_ID, clearDeviceData } from '@/lib/sign-out-client'
import { toast } from '@/lib/toast'

/** Opciones de `signOut`. */
export interface SignOutOptions {
  /** Sale sin preguntar nada, aunque haya cambios sin guardar (p. ej. después de borrar la cuenta). */
  skipConfirm?: boolean
  /** Confirmación de quien llama, cuando la bandeja no tiene cambios sin guardar (si tiene, se pregunta por ellos). */
  confirm?: ConfirmOptions
}

/**
 * En qué está "Salir" en esta pestaña: `syncing`, esperando las escrituras pendientes (el botón dice "Sincronizando…");
 * `confirming`, con la confirmación abierta; `closing`, borrando los datos ("Cerrando sesión…" en lugar de la app, también
 * cuando sale otra pestaña). null: no está saliendo.
 */
export type SignOutPhase = 'syncing' | 'confirming' | 'closing' | null

/**
 * `cancelled`: no confirmó, o ya estaba saliendo (esta pestaña u otra). `signed-out`: salió y se borraron los datos del dispositivo. `cache-kept`: salió, pero
 * otra pestaña no soltó la caché de Firestore (ya se avisó con un toast que hay que cerrarla).
 */
export type SignOutResult = 'cancelled' | 'signed-out' | 'cache-kept'

interface AuthState {
  user: User | null
  loading: boolean
  /** Google con popup; donde no hay popups (algunas PWA instaladas en iOS) pasa a redirect. */
  signIn: () => Promise<void>
  /**
   * "Salir": espera hasta `PENDING_WRITES_WAIT_MS` las escrituras pendientes; si la bandeja tiene cambios sin guardar
   * o quedan escrituras, pide confirmación (`signOutWarning`); borra los datos de la cuenta de este dispositivo
   * (`clearDeviceData`) y cierra la sesión. Las otras pestañas se cierran solas. Mientras está en curso, otra llamada
   * no hace nada (`cancelled`).
   */
  signOut: (options?: SignOutOptions) => Promise<SignOutResult>
  /** En qué está "Salir", para el botón (`SignOutPhase`). */
  signingOut: SignOutPhase
  /** ID token para llamar a las API routes. */
  getToken: () => Promise<string>
}

const AuthContext = createContext<AuthState | null>(null)

/**
 * Sesión de Firebase Auth. Mientras se cierra la sesión (en esta pestaña o en otra, por `DEVICE_CHANNEL`) muestra
 * "Cerrando sesión…" en lugar de la app, así no queda nada en pantalla de la cuenta que sale. Toda pestaña que no es
 * la que sale, cuando la sesión que tenía se cierra (`leavesOnSignedOut`), suelta Firestore y recarga en `/login`; la
 * que recibe el aviso del canal (`followsSignOut`) además cierra la confirmación abierta y oculta la app enseguida (y
 * recarga igual a los `FOLLOWER_RELOAD_MS`).
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)
  const [phase, setPhase] = useState<SignOutPhase>(null)
  const confirm = useConfirm()
  const dismissConfirm = useDismissConfirm()
  const current = useRef<User | null>(null)
  const leading = useRef(false)
  const clearing = useRef(false)
  const following = useRef(false)
  const closed = useRef<(() => void) | null>(null)
  const closing = phase === 'closing'

  useEffect(() => {
    if (!isFirebaseConfigured) return
    return onAuthStateChanged(firebaseAuth(), u => {
      const hadUser = current.current != null
      current.current = u
      if (leavesOnSignedOut({ hadUser, hasUser: u != null, leading: clearing.current })) {
        following.current = true
        void releaseFirestore(true).finally(() => window.location.replace('/login'))
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
      if (!followsSignOut(event.data, TAB_ID, current.current?.uid ?? null)) return
      if (clearing.current || following.current) return
      following.current = true
      dismissConfirm()
      setPhase('closing')
      window.setTimeout(() => window.location.reload(), FOLLOWER_RELOAD_MS)
    }
    return () => channel.close()
  }, [dismissConfirm])

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
    if (leading.current || following.current) return 'cancelled'
    leading.current = true
    const uid = user?.uid
    try {
      if (!skipConfirm) {
        setPhase('syncing')
        const writes = uid ? await settleWithin(Promise.resolve().then(waitForServerWrites), PENDING_WRITES_WAIT_MS) : 'done'
        if (following.current) return 'cancelled'
        const outbox = uid ? unsavedOutbox(readOutbox(uid), Date.now()) : { unsaved: 0, pending: 0 }
        const warning = signOutWarning({
          unsaved: outbox.unsaved,
          outboxPending: outbox.pending,
          writesPending: writes === 'timeout',
        })
        const options: ConfirmOptions | undefined = warning ? { ...warning, tone: 'danger', icon: LogOut } : ask
        setPhase('confirming')
        if (options && !(await confirm(options))) return 'cancelled'
        if (following.current) return 'cancelled'
      }
      clearing.current = true
      await new Promise<void>(resolve => {
        closed.current = resolve
        setPhase('closing')
      })
      const cleared = uid ? await clearDeviceData(uid) : true
      await fbSignOut(firebaseAuth())
      current.current = null
      setUser(null)
      if (cleared) return 'signed-out'
      toast.warning('Cerraste sesión', {
        description: 'Cerrá las otras pestañas de AutoCar para terminar de borrar los datos de este dispositivo.',
        timeout: 0,
      })
      return 'cache-kept'
    } finally {
      leading.current = false
      clearing.current = false
      if (!following.current) setPhase(null)
    }
  }

  const value: AuthState = {
    user,
    loading,
    signIn,
    signOut,
    signingOut: phase,
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
