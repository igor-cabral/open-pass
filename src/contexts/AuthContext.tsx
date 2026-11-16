import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { callFunction } from '@/lib/api'
import type { Profile } from '@/types'

interface AuthContextValue {
  profile: Profile | null
  loading: boolean
  // identifier = telefone OU e-mail
  loginCustomer: (identifier: string, password: string) => Promise<void>
  applyTokens: (tokens: { access_token: string; refresh_token: string }) => Promise<void>
  loginStaff: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData.session?.user
    if (!user) {
      setProfile(null)
      setLoading(false)
      return
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (error || !data) {
      setProfile(null)
    } else {
      setProfile(data as Profile)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    loadProfile()
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      loadProfile()
    })
    return () => sub.subscription.unsubscribe()
  }, [loadProfile])

  // A Edge Function valida a senha (e o limite de tentativas) no servidor e
  // devolve a sessão pronta; aqui só aplicamos essa sessão no navegador.
  async function applyTokens(tokens: { access_token: string; refresh_token: string }) {
    const { error } = await supabase.auth.setSession(tokens)
    if (error) throw error
  }

  async function loginCustomer(identifier: string, password: string) {
    const body = await callFunction<{ access_token: string; refresh_token: string }>('customer-login', {
      identifier: identifier.trim(),
      password,
    })
    await applyTokens(body)
  }

  async function loginStaff(username: string, password: string) {
    const body = await callFunction<{ access_token: string; refresh_token: string }>('staff-login', {
      username,
      password,
    })
    await applyTokens(body)
  }

  async function logout() {
    await supabase.auth.signOut()
    setProfile(null)
  }

  async function changePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
    await supabase.rpc('clear_must_change_password')
    await loadProfile()
  }

  return (
    <AuthContext.Provider
      value={{
        profile,
        loading,
        loginCustomer,
        loginStaff,
        applyTokens,
        logout,
        changePassword,
        refreshProfile: loadProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
