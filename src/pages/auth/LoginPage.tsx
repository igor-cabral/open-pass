import { useEffect, useState } from 'react'
import { useNavigate, Navigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { OpenPassLogo, DevCredit } from '@/components/ui/Brand'
import { homeForRole } from '@/components/layout/ProtectedRoute'

type Mode = 'customer' | 'staff'

export default function LoginPage() {
  const { profile, loginCustomer, loginStaff } = useAuth()
  const navigate = useNavigate()

  // Login sempre aparece no modo claro, mesmo que a pessoa já tenha
  // escolhido o modo escuro antes — não mexe na preferência salva, só
  // some visualmente enquanto essa tela está aberta.
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.remove('dark')
    return () => {
      if (wasDark) document.documentElement.classList.add('dark')
    }
  }, [])
  const [mode, setMode] = useState<Mode>('customer')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  if (profile) return <Navigate to={homeForRole(profile.role)} replace />

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      if (mode === 'customer') {
        await loginCustomer(identifier, password)
      } else {
        await loginStaff(username, password)
      }
      navigate('/')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="sr-only">OpenPass</h1>
          <OpenPassLogo className="h-20 mx-auto" />
          <p className="text-ink/60 text-sm mt-3">Ingressos digitais para o seu evento</p>
        </div>

        <Card className="p-6">
          <div className="flex rounded-xl bg-ink/5 p-1 mb-5">
            <button
              type="button"
              onClick={() => setMode('customer')}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${mode === 'customer' ? 'bg-surface shadow-sm' : 'text-ink/50'}`}
            >
              Sou cliente
            </button>
            <button
              type="button"
              onClick={() => setMode('staff')}
              className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${mode === 'staff' ? 'bg-surface shadow-sm' : 'text-ink/50'}`}
            >
              Equipe do evento
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'customer' ? (
              <Input
                label="Telefone ou e-mail"
                placeholder="(47) 99123-4567 ou voce@email.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoCapitalize="none"
                required
              />
            ) : (
              <Input
                label="Usuário"
                placeholder="joao"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoCapitalize="none"
                required
              />
            )}
            <Input
              label="Senha"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Button type="submit" fullWidth size="lg" loading={loading}>
              Entrar
            </Button>
          </form>

          {mode === 'customer' && (
            <p className="text-center mt-3">
              <Link to="/esqueci-senha" className="text-sm text-primary font-medium">
                Esqueci minha senha
              </Link>
            </p>
          )}

          {mode === 'customer' && (
            <p className="text-xs text-ink/50 mt-4 text-center">
              Ainda não tem conta? Peça o link (ou QR) do seu ingresso ao caixa — a conta é criada ao abri-lo.
            </p>
          )}
        </Card>
        <DevCredit className="mt-6" />
      </div>
    </div>
  )
}
