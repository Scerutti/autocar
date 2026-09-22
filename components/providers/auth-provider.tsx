'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth'
import { firebaseAuth, isFirebaseConfigured } from '@/lib/firebase/client'

interface AuthState {
  user: User | null
  loading: boolean
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  /** ID token para llamar a las API routes. */
  getToken: () => Promise<string>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(isFirebaseConfigured)

  useEffect(() => {
    if (!isFirebaseConfigured) return
    return onAuthStateChanged(firebaseAuth(), u => {
      setUser(u)
      setLoading(false)
    })
  }, [])

  async function signIn() {
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    try {
      await signInWithPopup(firebaseAuth(), provider)
    } catch (e) {
      const code = (e as { code?: string }).code
      // En algunas PWA instaladas (iOS) los popups no están permitidos.
      if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
        await signInWithRedirect(firebaseAuth(), provider)
        return
      }
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return
      throw e
    }
  }

  const value: AuthState = {
    user,
    loading,
    signIn,
    signOut: () => fbSignOut(firebaseAuth()),
    getToken: async () => {
      if (!user) throw new Error('No hay sesión')
      return user.getIdToken()
    },
  }

  return <AuthContext value={value}>{children}</AuthContext>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
