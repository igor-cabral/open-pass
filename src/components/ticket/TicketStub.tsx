import type { MyTicket } from '@/types'
import { formatCurrency, formatDate, formatDateTime, formatTime } from '@/utils/format'
import { QrCode } from './QrCode'
import { Badge } from '@/components/ui/Badge'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import { useAuth } from '@/contexts/AuthContext'
import { useWakeLock } from '@/hooks/useWakeLock'

type Tone = 'success' | 'warning' | 'danger' | 'neutral'

// Estado do ingresso, em ordem de prioridade. `code` = mostra o QR.
function resolveState(t: MyTicket): { label: string; tone: Tone; icon: string; message?: string; code: boolean } {
  if (t.status === 'cancelled') return { label: 'Cancelado', tone: 'danger', icon: '🚫', message: 'Este ingresso foi cancelado.', code: false }
  if (t.status === 'fully_redeemed') return { label: 'Utilizado', tone: 'neutral', icon: '✅', message: t.has_credit ? 'Tudo foi entregue e o saldo foi totalmente utilizado.' : 'Todos os itens deste ingresso já foram entregues.', code: false }
  if (t.ended) return { label: 'Encerrado', tone: 'neutral', icon: '🏁', message: 'Este evento já terminou.', code: false }
  if (t.blocked_reason) {
    const pending = /pendente/i.test(t.blocked_reason)
    return { label: pending ? 'Pagamento pendente' : 'Bloqueado', tone: pending ? 'warning' : 'danger', icon: pending ? '⏳' : '⛔', message: t.blocked_reason, code: false }
  }
  if (t.locked) return { label: 'Em breve', tone: 'warning', icon: '🕒', message: `Seu ingresso fica disponível no dia do evento (${formatDate(t.event_date)}).`, code: false }
  return { label: 'Válido', tone: 'success', icon: '🎟️', code: true }
}

export function TicketStub({ ticket }: { ticket: MyTicket }) {
  const { profile } = useAuth()
  const st = resolveState(ticket)
  const showCode = st.code && !!ticket.public_code
  useWakeLock(showCode)

  const base = ticket.primary_color || '#0466FC'
  const headerStyle = {
    backgroundColor: base,
    backgroundImage: `linear-gradient(135deg, ${base}, color-mix(in srgb, ${base} 62%, #000))`,
  }

  const bannerTone: Record<Tone, string> = {
    success: 'bg-success/15 text-success-ink',
    warning: 'bg-accent/20 text-accent-dark',
    danger: 'bg-danger/10 text-danger',
    neutral: 'bg-ink/5 text-ink/70',
  }

  return (
    <div className="bg-surface rounded-[1.75rem] shadow-lift overflow-hidden border border-line/50 animate-ticket-in">
      <div className="relative overflow-hidden text-white px-6 py-6" style={headerStyle}>
        {/* círculos decorativos, no estilo dos cartões de carteira */}
        <span className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-white/10" />
        <span className="pointer-events-none absolute -left-8 -bottom-16 h-36 w-36 rounded-full bg-black/10" />
        <div className="relative flex items-center justify-between gap-3">
          <p className="text-xs uppercase tracking-widest text-white/75 font-semibold">{ticket.event_name}</p>
          {ticket.logo_url && (
            <img src={ticket.logo_url} alt="" className="h-14 w-14 object-contain rounded-2xl bg-white/15 p-1" />
          )}
        </div>
        <div className="relative flex items-end justify-between mt-4 gap-3">
          <div>
            <p className="font-display font-bold text-3xl leading-none">{formatDate(ticket.event_date)}</p>
            <p className="text-white/85 text-sm mt-1.5">{formatTime(ticket.event_time)} · {ticket.location}</p>
          </div>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
      </div>

      {/* "Perfuração" do ticket */}
      <div className="relative">
        <div className="absolute -left-3 -top-3 h-6 w-6 rounded-full bg-paper" />
        <div className="absolute -right-3 -top-3 h-6 w-6 rounded-full bg-paper" />
        <div className="border-t-2 border-dashed border-line mx-4" />
      </div>

      <div className="px-6 py-5">
        {profile?.full_name && (
          <div className="mb-5">
            <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold">Titular</p>
            <p className="font-display font-bold text-xl leading-tight">{profile.full_name}</p>
          </div>
        )}

        {ticket.has_credit && (
          <div className="mb-6 rounded-3xl bg-gradient-to-br from-violet to-primary text-white px-5 py-5 shadow-glow">
            <p className="text-xs uppercase tracking-widest text-white/75 font-semibold">Saldo (ficha digital)</p>
            <p className="font-display font-bold text-5xl leading-tight tabular-nums"><AnimatedNumber value={Number(ticket.credit_balance)} format={formatCurrency} /></p>
            {ticket.spends.length > 0 && (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer font-medium text-white/90">Ver consumo ({ticket.spends.length})</summary>
                <ul className="mt-2 space-y-2">
                  {ticket.spends.map((sp, i) => (
                    <li key={i} className="flex justify-between gap-3">
                      <span className="text-white/85">
                        {sp.items.map((it) => `${it.quantity}× ${it.name}`).join(', ')}
                        <span className="block text-xs text-white/60">{formatDateTime(sp.at)}{sp.station_name ? ` · ${sp.station_name}` : ''}</span>
                      </span>
                      <span className="font-semibold whitespace-nowrap">− {formatCurrency(Number(sp.total))}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        {ticket.items.length > 0 && <p className="text-xs uppercase tracking-widest text-ink/40 font-semibold mb-3">Itens do seu ingresso</p>}
        <ul className="space-y-2.5 mb-6">
          {ticket.items.map((item, i) => {
            const done = item.available === 0
            return (
              <li key={i} className={`flex items-center justify-between gap-3 ${done ? 'opacity-45' : ''}`}>
                <span className={`text-base font-semibold ${done ? 'line-through' : ''}`}>
                  {item.quantity_purchased}× {item.product_name}
                </span>
                <span className={`text-sm font-bold whitespace-nowrap ${done ? 'text-ink/60' : 'text-primary-dark'}`}>
                  {done ? 'Entregue ✓' : `${item.available} restante${item.available === 1 ? '' : 's'}`}
                </span>
              </li>
            )
          })}
        </ul>

        <div className="border-t border-line pt-5">
          {showCode ? (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-3xl bg-white p-4 shadow-card ring-1 ring-line/60">
                <QrCode value={ticket.public_code!} size={300} />
              </div>
              <p className="text-xs text-ink/50 text-center">
                Mostre este QR ao validador. A tela fica acesa enquanto o ingresso estiver aberto.
              </p>
            </div>
          ) : (
            <div className={`rounded-2xl px-4 py-5 text-center ${bannerTone[st.tone]}`}>
              <p className="text-3xl mb-1">{st.icon}</p>
              <p className="font-display font-bold text-lg">{st.label}</p>
              {st.message && <p className="text-sm mt-1">{st.message}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
