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
    <div className="min-h-screen brand-glow flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-5xl lg:grid lg:grid-cols-2 lg:gap-16 lg:items-center">
        {/* Vitrine (só em tela grande) */}
        <div className="hidden lg:block">
          <div className="grid grid-cols-2 gap-3 w-40 mb-8" aria-hidden>
            <span className="h-[4.5rem] rounded-2xl rounded-br-3xl bg-accent animate-pop-in" style={{ animationDelay: '0ms' }} />
            <span className="h-[4.5rem] rounded-2xl rounded-bl-3xl bg-primary animate-pop-in" style={{ animationDelay: '80ms' }} />
            <span className="h-[4.5rem] rounded-2xl rounded-tr-3xl bg-violet animate-pop-in" style={{ animationDelay: '160ms' }} />
            <span className="h-[4.5rem] rounded-2xl rounded-tl-3xl bg-success animate-pop-in" style={{ animationDelay: '240ms' }} />
          </div>
          <h2 className="font-display font-bold text-5xl leading-[1.05] tracking-tight">
            Ingressos e fichas<br />
            <span className="text-primary">sem fila, sem troco.</span>
          </h2>
          <p className="text-ink/60 text-lg mt-5 max-w-md">
            Venda no caixa, entregue com um toque e acompanhe tudo em tempo real.
          </p>
        </div>

        <div className="w-full max-w-sm mx-auto animate-sheet-up">
        <div className="text-center mb-8 lg:hidden">
          <h1 className="sr-only">OpenPass</h1>
          <OpenPassLogo className="h-20 mx-auto" />
          <p className="text-ink/60 text-sm mt-3">Ingressos digitais para o seu evento</p>
        </div>
        <div className="hidden lg:block mb-6">
          <h1 className="sr-only">OpenPass</h1>
          <OpenPassLogo className="h-12" />
        </div>

        <Card className="p-6 shadow-lift">
          <div className="flex rounded-2xl bg-ink/5 p-1 mb-5">
            <button
              type="button"
              onClick={() => setMode('customer')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${mode === 'customer' ? 'bg-surface shadow-sm' : 'text-ink/50'}`}
            >
              Sou cliente
            </button>
            <button
              type="button"
              onClick={() => setMode('staff')}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold transition-all ${mode === 'staff' ? 'bg-surface shadow-sm' : 'text-ink/50'}`}
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
    </div>
  )
}
