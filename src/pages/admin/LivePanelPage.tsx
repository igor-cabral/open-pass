import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { listEvents } from '@/services/events'
import { liveDashboard } from '@/services/admin'
import { supabase } from '@/lib/supabaseClient'
import { useWakeLock } from '@/hooks/useWakeLock'
import { AnimatedNumber } from '@/components/ui/AnimatedNumber'
import type { EventItem, LiveDashboard } from '@/types'
import { formatCurrency } from '@/utils/format'

const METHOD_LABEL: Record<string, string> = { cash: 'Dinheiro', pix: 'PIX', card: 'Cartão', other: 'Outro' }

function hhmm(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function Stat({ label, value, sub, format }: { label: string; value: string | number; sub?: string; format?: (n: number) => string }) {
  return (
    <div className="rounded-3xl bg-white/5 border border-white/10 p-5 backdrop-blur">
      <p className="text-sm uppercase tracking-wide text-white/60">{label}</p>
      <p className="font-display font-bold text-4xl sm:text-5xl mt-1 tabular-nums">
        {typeof value === 'number' ? <AnimatedNumber value={value} format={format} /> : value}
      </p>
      {sub && <p className="text-sm text-white/50 mt-1">{sub}</p>}
    </div>
  )
}

// Tela cheia para o telão da coordenação. Fundo escuro, números grandes,
// atualiza sozinha (Realtime + a cada 5 s) e mantém a tela acesa.
export default function LivePanelPage() {
  const [params, setParams] = useSearchParams()
  const [events, setEvents] = useState<EventItem[]>([])
  const eventId = params.get('e') || ''
  const [data, setData] = useState<LiveDashboard | null>(null)
  const [error, setError] = useState('')
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  useWakeLock(true)

  useEffect(() => {
    listEvents()
      .then((evs) => {
        setEvents(evs)
        if (!params.get('e') && evs.length > 0) {
          const today = evs.find((e) => e.status === 'published') || evs[0]
          setParams({ e: today.id }, { replace: true })
        }
      })
      .catch((e) => setError(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!eventId) return
    let alive = true
    const load = () => {
      liveDashboard(eventId)
        .then((d) => {
          if (!alive) return
          setData(d)
          setError('')
          setUpdatedAt(new Date())
        })
        .catch((e) => alive && setError(e.message))
    }
    setData(null)
    load()
    const channel = supabase
      .channel(`live-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `event_id=eq.${eventId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redemptions', filter: `event_id=eq.${eventId}` }, load)
      .subscribe()
    const interval = setInterval(load, 5000)
    return () => {
      alive = false
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [eventId])

  const ev = events.find((e) => e.id === eventId)
  const maxHour = useMemo(() => Math.max(1, ...(data?.by_hour.map((h) => h.orders) ?? [1])), [data])

  function fullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void document.documentElement.requestFullscreen?.()
  }

  return (
    <div className="min-h-screen text-white p-4 sm:p-8" style={{ background: "radial-gradient(60rem 30rem at 90% -10%, rgba(4,102,252,.25), transparent 60%), radial-gradient(40rem 24rem at -10% 110%, rgba(132,52,188,.22), transparent 60%), #0b1220" }}>
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <p className="text-sm uppercase tracking-widest text-white/50">OpenPass · ao vivo</p>
          <h1 className="font-display font-bold text-3xl sm:text-4xl">{ev?.name || 'Selecione o evento'}</h1>
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <select
            value={eventId}
            onChange={(e) => setParams({ e: e.target.value })}
            className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-sm text-white"
          >
            {events.map((e) => (
              <option key={e.id} value={e.id} className="text-black">{e.name}</option>
            ))}
          </select>
          <button onClick={fullscreen} className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-sm hover:bg-white/20">
            Tela cheia
          </button>
          <Link to="/admin" className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-sm hover:bg-white/20">
            Voltar
          </Link>
        </div>
      </header>

      {error && <p className="rounded-xl bg-red-500/20 border border-red-400/40 p-3 mb-4 text-sm">{error}</p>}
      {!data && !error && <p className="text-white/60">Carregando…</p>}

      {data && (
        <div className="space-y-6">
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat label="Arrecadado" value={Number(data.totals.revenue)} format={formatCurrency} sub={data.totals.pending > 0 ? `+ ${formatCurrency(data.totals.pending)} pendente` : undefined} />
            <Stat label="Vendas" value={data.totals.orders} sub={`${data.totals.courtesies} cortesias`} />
            <Stat
              label="Itens entregues"
              value={`${data.totals.items_delivered}/${data.totals.items_sold}`}
              sub={data.totals.items_sold > 0 ? `${Math.round((data.totals.items_delivered / data.totals.items_sold) * 100)}% entregue` : undefined}
            />
            <Stat label="Ficha digital" value={Number(data.totals.credit_spent)} format={formatCurrency} sub={`saldo em aberto ${formatCurrency(data.totals.credit_outstanding)}`} />
          </section>

          <div className="grid lg:grid-cols-3 gap-6">
            <section className="lg:col-span-2 rounded-3xl bg-white/5 border border-white/10 p-5">
              <h2 className="font-display font-semibold text-xl mb-4">Produtos</h2>
              <ul className="space-y-3">
                {data.by_product.length === 0 && <li className="text-white/50">Sem produtos.</li>}
                {data.by_product.map((p) => {
                  const pct = p.stock_limit ? Math.min(100, Math.round((p.sold / p.stock_limit) * 100)) : null
                  const hot = pct !== null && pct >= 80
                  return (
                    <li key={p.product_name}>
                      <div className="flex justify-between text-lg">
                        <span className="font-semibold">{p.product_name}</span>
                        <span className="tabular-nums text-white/80">
                          {p.sold} vendidos · {p.delivered} entregues
                          {p.stock_limit ? ` · limite ${p.stock_limit}` : ''}
                        </span>
                      </div>
                      {pct !== null && (
                        <div className="h-2.5 rounded-full bg-white/10 mt-1.5 overflow-hidden">
                          <div className={`h-full rounded-full transition-all duration-700 ${hot ? 'bg-red-400' : 'bg-emerald-400'}`} style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="rounded-3xl bg-white/5 border border-white/10 p-5">
              <h2 className="font-display font-semibold text-xl mb-4">Entregas por ponto</h2>
              <ul className="space-y-2 text-lg">
                {data.by_station.length === 0 && <li className="text-white/50">Nenhuma entrega ainda.</li>}
                {data.by_station.map((s) => (
                  <li key={s.station_name} className="flex justify-between">
                    <span>{s.station_name}</span>
                    <span className="font-bold tabular-nums">{s.items}</span>
                  </li>
                ))}
              </ul>
              {data.by_hour.length > 0 && (
                <>
                  <h3 className="font-display font-semibold mt-6 mb-2 text-white/80">Vendas por hora</h3>
                  <div className="flex items-end gap-1.5 h-24">
                    {data.by_hour.map((h) => (
                      <div key={h.hour} className="flex-1 flex flex-col items-center justify-end h-full">
                        <div className="w-full rounded-t bg-sky-400" style={{ height: `${(h.orders / maxHour) * 100}%`, minHeight: 4 }} title={`${h.orders} vendas`} />
                        <span className="text-[10px] text-white/50 mt-1">{h.hour}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <section className="rounded-3xl bg-white/5 border border-white/10 p-5">
              <h2 className="font-display font-semibold text-xl mb-3">Últimas vendas</h2>
              <ul className="divide-y divide-white/10">
                {data.recent_sales.length === 0 && <li className="text-white/50 py-2">Nenhuma venda ainda.</li>}
                {data.recent_sales.map((s) => (
                  <li key={s.order_number} className="py-2 flex justify-between gap-3">
                    <span>
                      <span className="text-white/50 tabular-nums mr-2">{hhmm(s.at)}</span>
                      #{s.order_number} {s.buyer_name && <span className="text-white/70">· {s.buyer_name}</span>}
                      <span className="block text-xs text-white/50">
                        {s.cashier_name} · {s.is_courtesy ? 'Cortesia' : METHOD_LABEL[s.payment_method] || s.payment_method}
                        {s.payment_status === 'pending' ? ' · pendente' : ''}
                      </span>
                    </span>
                    <span className="font-bold tabular-nums">{s.is_courtesy ? '—' : formatCurrency(s.total)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="rounded-3xl bg-white/5 border border-white/10 p-5">
              <h2 className="font-display font-semibold text-xl mb-3">Últimas entregas</h2>
              <ul className="divide-y divide-white/10">
                {data.recent_deliveries.length === 0 && <li className="text-white/50 py-2">Nenhuma entrega ainda.</li>}
                {data.recent_deliveries.map((d, i) => (
                  <li key={`${d.at}-${i}`} className="py-2">
                    <span className="text-white/50 tabular-nums mr-2">{hhmm(d.at)}</span>
                    {d.summary}
                    <span className="block text-xs text-white/50">
                      {d.station_name} · {d.validator_name}{d.kind === 'credit' ? ' · ficha digital' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}

      <footer className="mt-6 text-xs text-white/40">
        {updatedAt ? `Atualizado às ${updatedAt.toLocaleTimeString('pt-BR')} · atualiza sozinho` : ''}
      </footer>
    </div>
  )
}
