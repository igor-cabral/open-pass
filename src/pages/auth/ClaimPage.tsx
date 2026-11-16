import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useAuth } from '@/contexts/AuthContext'
import { peekClaim, claimWithNewAccount, claimToCurrentAccount } from '@/services/claim'
import type { ClaimPreview } from '@/types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Card } from '@/components/ui/Card'
import { OpenPassLogo, DevCredit } from '@/components/ui/Brand'
import { Loading } from '@/components/ui/Loading'
import { formatCurrency, formatDate, formatTime } from '@/utils/format'
import { formatPhone, isValidEmail } from '@/utils/phone'

type Mode = 'create' | 'login'

// Tela aberta pelo link/QR que o caixa entrega. O token vem na URL (/t/<token>).
export default function ClaimPage() {
  const { token = '' } = useParams()
  const navigate = useNavigate()
  const { profile, loginCustomer, applyTokens, refreshProfile } = useAuth()

  const [preview, setPreview] = useState<ClaimPreview | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>('create')
  const [busy, setBusy] = useState(false)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [identifier, setIdentifier] = useState('')

  useEffect(() => {
    peekClaim(token)
      .then(setPreview)
      .catch((err) => setInvalid((err as Error).message))
  }, [token])

  async function attach() {
    await claimToCurrentAccount(token)
    toast.success('Ingresso salvo na sua conta!')
    navigate('/meus-tickets', { replace: true })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!isValidEmail(email)) return toast.error('Informe um e-mail válido.')
    if (phone.replace(/\D/g, '').length < 10) return toast.error('Informe um telefone válido com DDD.')
    if (password.length < 8) return toast.error('A senha precisa ter ao menos 8 caracteres.')
    setBusy(true)
    try {
      const res = await claimWithNewAccount({ token, full_name: fullName.trim(), phone, email: email.trim(), password })
      if (res.access_token && res.refresh_token) {
        await applyTokens({ access_token: res.access_token, refresh_token: res.refresh_token })
        await refreshProfile()
      }
      toast.success('Conta criada! Seu ingresso já está nela.')
      navigate('/meus-tickets', { replace: true })
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      await loginCustomer(identifier, password)
      await attach()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function handleAttachLoggedIn() {
    setBusy(true)
    try {
      await attach()
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (invalid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper px-4">
        <Card className="p-6 max-w-sm text-center space-y-3">
          <p className="text-3xl">🎟️</p>
          <h1 className="font-display font-bold text-xl">Link indisponível</h1>
          <p className="text-sm text-ink/60">{invalid}</p>
          <p className="text-sm text-ink/60">Peça ao caixa para gerar um novo link.</p>
          <Link to="/login" className="text-primary font-medium text-sm">Ir para o login</Link>
          <DevCredit className="pt-3" />
        </Card>
      </div>
    )
  }
  if (!preview) return <Loading label="Abrindo seu ingresso…" />

  const isCustomer = profile?.role === 'customer'

  return (
    <div className="min-h-screen bg-paper px-4 py-8">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="text-center"><OpenPassLogo className="h-10 mx-auto" /></div>
        <Card className="overflow-hidden p-0">
          <div className="bg-primary text-white px-5 py-4" style={preview.primary_color ? { backgroundColor: preview.primary_color } : undefined}>
            <p className="text-xs uppercase tracking-widest text-white/70 font-semibold">Seu ingresso</p>
            <p className="font-display font-bold text-xl">{preview.event_name}</p>
            <p className="text-white/80 text-sm">
              {formatDate(preview.event_date)} · {formatTime(preview.event_time)} · {preview.location}
            </p>
          </div>
          <ul className="px-5 py-4 text-sm space-y-1">
            {Number(preview.credit_balance) > 0 && (
              <li className="font-semibold text-primary-dark">💳 Saldo para gastar: {formatCurrency(Number(preview.credit_balance))}</li>
            )}
            {preview.items.map((i, idx) => (
              <li key={idx}>{i.quantity}x {i.name}</li>
            ))}
          </ul>
        </Card>

        {isCustomer ? (
          <Card className="p-5 space-y-3">
            <p className="text-sm">
              Você está logado como <b>{profile?.full_name}</b>. Salvar este ingresso na sua conta?
            </p>
            <Button fullWidth size="lg" loading={busy} onClick={handleAttachLoggedIn}>
              Salvar na minha conta
            </Button>
          </Card>
        ) : profile ? (
          <Card className="p-5 text-sm text-ink/70">
            Você está logado com uma conta da equipe. Saia dela e abra o link de novo para resgatar o ingresso.
          </Card>
        ) : (
          <Card className="p-5">
            <div className="flex rounded-xl bg-ink/5 p-1 mb-4">
              <button type="button" onClick={() => setMode('create')}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === 'create' ? 'bg-surface shadow-sm' : 'text-ink/50'}`}>
                Criar conta
              </button>
              <button type="button" onClick={() => setMode('login')}
                className={`flex-1 rounded-lg py-2 text-sm font-semibold ${mode === 'login' ? 'bg-surface shadow-sm' : 'text-ink/50'}`}>
                Já tenho conta
              </button>
            </div>

            {mode === 'create' ? (
              <form onSubmit={handleCreate} className="space-y-3">
                <Input label="Nome" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                <Input label="Telefone" inputMode="numeric" placeholder="(47) 99123-4567"
                  value={formatPhone(phone)} onChange={(e) => setPhone(e.target.value)} required />
                <Input label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  autoCapitalize="none" required />
                <Input label="Crie uma senha (mín. 8 caracteres)" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} minLength={8} required />
                <Button type="submit" fullWidth size="lg" loading={busy}>Criar conta e receber ingresso</Button>
              </form>
            ) : (
              <form onSubmit={handleLogin} className="space-y-3">
                <Input label="Telefone ou e-mail" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
                  autoCapitalize="none" required />
                <Input label="Senha" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                <Button type="submit" fullWidth size="lg" loading={busy}>Entrar e receber ingresso</Button>
                <p className="text-center">
                  <Link to="/esqueci-senha" className="text-sm text-primary font-medium">Esqueci minha senha</Link>
                </p>
              </form>
            )}
          </Card>
        )}
        <DevCredit className="pt-2" />
      </div>
    </div>
  )
}
