import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabaseClient'
import type { UserRole } from '@/types'
import { Loading } from '@/components/ui/Loading'
import { AdminPinGate } from '@/components/ui/AdminPinGate'

type PinState = 'checking' | 'ok' | 'needed'

export function ProtectedRoute({ roles, children }: { roles: UserRole[]; children: React.ReactNode }) {
  const { profile, loading } = useAuth()
  const [pin, setPin] = useState<PinState>('checking')

  // A segunda etapa do admin é validada NO SERVIDOR (admin_pin_status): sem o
  // PIN confirmado o banco não entrega nenhum dado administrativo, mesmo que
  // alguém chame a API direto. Reconsultamos a cada minuto para pegar a expiração (8 h).
  const isAdmin = profile?.role === 'admin'
  useEffect(() => {
    try {
      sessionStorage.removeItem('sidata-admin-2fa-ok') // resquício da versão antiga (só visual)
    } catch {
      /* sem sessionStorage: ok */
    }
    if (!isAdmin) return
    let cancelled = false
    const check = async () => {
      const { data, error } = await supabase.rpc('admin_pin_status')
      if (cancelled) return
      setPin(error || data === 'needed' ? 'needed' : 'ok')
    }
    check()
    const id = setInterval(check, 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [isAdmin])

  if (loading) return <Loading label="Verificando sessão…" />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.must_change_password) return <Navigate to="/trocar-senha" replace />
  if (!roles.includes(profile.role)) return <Navigate to={homeForRole(profile.role)} replace />

  if (isAdmin && pin === 'checking') return <Loading label="Verificando acesso…" />

  // Tela própria (não caixa nativa do navegador): no iPhone, com o app instalado,
  // prompt()/alert() não funcionam.
  if (isAdmin && pin === 'needed') {
    return <AdminPinGate onSuccess={() => setPin('ok')} />
  }

  return <>{children}</>
}

export function homeForRole(role: UserRole): string {
  switch (role) {
    case 'admin':
      return '/admin'
    case 'cashier':
      return '/caixa'
    case 'validator':
      return '/validador'
    case 'customer':
    default:
      return '/meus-tickets'
  }
}
