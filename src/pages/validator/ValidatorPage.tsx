import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser'
import { supabase } from '@/lib/supabaseClient'
import { getTicketForValidation, redeemTicketItems, getMyStation, undoRedemption, spendCredit, undoCreditSpend } from '@/services/tickets'
import { listMyEvents } from '@/services/events'
import type { EventItem, MyStation, ValidationTicket } from '@/types'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Loading } from '@/components/ui/Loading'
import { formatCurrency } from '@/utils/format'

export default function ValidatorPage() {
  const [events, setEvents] = useState<EventItem[] | null>(null)
  const [eventId, setEventId] = useState('')
  const [cameraOn, setCameraOn] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [ticket, setTicket] = useState<ValidationTicket | null>(null)
  const [selections, setSelections] = useState<Record<string, number>>({})
  const [loadingTicket, setLoadingTicket] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [station, setStation] = useState<MyStation | null>(null)
  const [flash, setFlash] = useState<{ kind: 'ok' | 'error'; title: string; detail?: string } | null>(null)
  const [lastRedemption, setLastRedemption] = useState<string | null>(null)
  // Um id por tentativa: toque duplo/retry não entrega duas vezes.
  const requestIdRef = useRef<string>(crypto.randomUUID())
  // Ficha digital: produtos a cobrar do saldo
  const [spendQty, setSpendQty] = useState<Record<string, number>>({})
  const [spending, setSpending] = useState(false)
  const [lastSpend, setLastSpend] = useState<string | null>(null)
  const spendRequestRef = useRef<string>(crypto.randomUUID())

  const videoRef = useRef<HTMLVideoElement>(null)
  const controlsRef = useRef<IScannerControls | null>(null)

  useEffect(() => {
    listMyEvents()
      .then((data) => {
        const usable = data.filter((e) => e.status !== 'draft')
        setEvents(usable)
        const today = usable.find((e) => e.status === 'published')
        if (today) setEventId(today.id)
        else if (usable.length > 0) setEventId(usable[0].id)
      })
      .catch((err) => toast.error(err.message))
    return () => {
      controlsRef.current?.stop()
    }
  }, [])

  // Feedback em tela cheia (verde = entregue, vermelho = recusado) por ~1,5s; toque fecha.
  useEffect(() => {
    if (!flash) return
    try { navigator.vibrate?.(flash.kind === 'ok' ? 80 : [120, 60, 120]) } catch { /* sem vibração */ }
    const t = setTimeout(() => setFlash(null), flash.kind === 'ok' ? 1500 : 2200)
    return () => clearTimeout(t)
  }, [flash])

  useEffect(() => {
    setStation(null)
    if (!eventId) return
    getMyStation(eventId).then(setStation).catch(() => setStation(null))
  }, [eventId])

  async function startCamera() {
    setCameraOn(true)
    try {
      const reader = new BrowserMultiFormatReader()
      const controls = await reader.decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
        if (result) {
          controls.stop()
          setCameraOn(false)
          void lookupTicket(result.getText())
        }
      })
      controlsRef.current = controls
    } catch (err) {
      toast.error('Não foi possível acessar a câmera. Use a digitação manual abaixo.')
      setCameraOn(false)
    }
  }

  function stopCamera() {
    controlsRef.current?.stop()
    setCameraOn(false)
  }

  async function lookupTicket(code: string) {
    if (!eventId) {
      toast.error('Selecione o evento primeiro.')
      return
    }
    setLoadingTicket(true)
    setTicket(null)
    setSelections({})
    setSpendQty({})
    try {
      const result = await getTicketForValidation(code, eventId)
      setTicket(result)
      if (result.blocked_reason) setFlash({ kind: 'error', title: 'Não pode entregar', detail: result.blocked_reason })
    } catch (err) {
      setFlash({ kind: 'error', title: 'Ingresso recusado', detail: (err as Error).message })
    } finally {
      setLoadingTicket(false)
    }
  }

  async function refreshTicketSilently(code: string) {
    try {
      const result = await getTicketForValidation(code, eventId)
      setTicket(result)
    } catch {
      // silencioso de propósito
    }
  }

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!manualCode.trim()) return
    void lookupTicket(manualCode.trim())
    setManualCode('')
  }

  function updateSelection(ticketItemId: string, delta: number, max: number) {
    setSelections((prev) => ({
      ...prev,
      [ticketItemId]: Math.min(max, Math.max(0, (prev[ticketItemId] || 0) + delta)),
    }))
  }

  async function handleConfirmDelivery() {
    if (!ticket) return
    const items = Object.entries(selections)
      .filter(([, qty]) => qty > 0)
      .map(([ticket_item_id, quantity]) => ({ ticket_item_id, quantity }))
    if (items.length === 0) {
      toast.error('Selecione ao menos um item para entregar.')
      return
    }
    setConfirming(true)
    try {
      const res = await redeemTicketItems(ticket.public_code, eventId, items, requestIdRef.current)
      requestIdRef.current = crypto.randomUUID()
      setLastRedemption(res.redemption_id)
      setFlash({
        kind: 'ok',
        title: res.duplicate ? 'Já registrado ✓' : 'Entregue ✓',
        detail: res.items?.map((i) => `${i.delivered_now}× ${i.product_name}`).join(' · '),
      })
      await lookupTicket(ticket.public_code)
      setSelections({})
    } catch (err) {
      const msg = (err as Error).message
      setFlash({ kind: 'error', title: /ponto/i.test(msg) ? 'Não é deste ponto' : 'Entrega recusada', detail: msg })
    } finally {
      setConfirming(false)
    }
  }

  const spendTotal = ticket
    ? ticket.menu.reduce((sum, m) => sum + (spendQty[m.product_id] || 0) * Number(m.price), 0)
    : 0

  function updateSpend(productId: string, delta: number) {
    setSpendQty((prev) => ({ ...prev, [productId]: Math.max(0, (prev[productId] || 0) + delta) }))
  }

  async function handleSpend() {
    if (!ticket) return
    const items = Object.entries(spendQty)
      .filter(([, q]) => q > 0)
      .map(([product_id, quantity]) => ({ product_id, quantity }))
    if (items.length === 0) return toast.error('Selecione ao menos um produto.')
    setSpending(true)
    try {
      const res = await spendCredit(ticket.public_code, eventId, items, spendRequestRef.current)
      spendRequestRef.current = crypto.randomUUID()
      setLastSpend(res.spend_id)
      setFlash({
        kind: 'ok',
        title: `Cobrado ${formatCurrency(res.total)} ✓`,
        detail: `Saldo restante: ${formatCurrency(res.balance)}`,
      })
      await lookupTicket(ticket.public_code)
      setSpendQty({})
    } catch (err) {
      const msg = (err as Error).message
      setFlash({ kind: 'error', title: /saldo/i.test(msg) ? 'Saldo insuficiente' : /ponto|vendido neste/i.test(msg) ? 'Não é deste ponto' : 'Cobrança recusada', detail: msg })
    } finally {
      setSpending(false)
    }
  }

  async function handleUndoSpend() {
    if (!lastSpend || !ticket) return
    try {
      await undoCreditSpend(lastSpend)
      setLastSpend(null)
      toast.success('Cobrança desfeita.')
      await lookupTicket(ticket.public_code)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function handleUndo() {
    if (!lastRedemption || !ticket) return
    try {
      await undoRedemption(lastRedemption)
      setLastRedemption(null)
      toast.success('Entrega desfeita.')
      await lookupTicket(ticket.public_code)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  function scanAnother() {
    setLastRedemption(null)
    setLastSpend(null)
    setSpendQty({})
    setTicket(null)
    setSelections({})
  }

  useEffect(() => {
    if (!ticket) return
    const channel = supabase
      .channel(`ticket-${ticket.ticket_id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ticket_items' }, () => {
        void refreshTicketSilently(ticket.public_code)
      })
      .subscribe()

    const interval = setInterval(() => {
      void refreshTicketSilently(ticket.public_code)
    }, 2000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.ticket_id])

  if (events === null) return <Loading label="Carregando eventos…" />

  return (
    <div className="max-w-md mx-auto space-y-5">
      {flash && (
        <button
          type="button"
          onClick={() => setFlash(null)}
          className={`fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 text-center text-white animate-fade-in-up ${
            flash.kind === 'ok' ? 'bg-[#12A150]' : 'bg-[#D62839]'
          }`}
        >
          <span className="text-8xl leading-none animate-check-pop">{flash.kind === 'ok' ? '✓' : '✕'}</span>
          <span className="font-display font-bold text-4xl">{flash.title}</span>
          {flash.detail && <span className="text-lg text-white/90 max-w-sm">{flash.detail}</span>}
          <span className="text-sm text-white/70 mt-4">Toque para fechar</span>
        </button>
      )}
      <h1 className="font-display font-bold text-2xl">Validar ticket</h1>

      <Select label="Evento" value={eventId} onChange={(e) => { setEventId(e.target.value); setTicket(null) }}>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>{ev.name} — {ev.event_date}</option>
        ))}
      </Select>

      {station?.needs_station && (
        <Card className="p-4 text-sm text-danger font-medium">
          Este evento tem pontos de entrega e você ainda não foi atribuído a um. Peça ao administrador.
        </Card>
      )}
      {station?.station_name && (
        <p className="text-sm text-ink/60">Seu ponto: <b className="text-ink">{station.station_name}</b></p>
      )}

      {!ticket && (
        <>
          <Card className="p-4 space-y-3">
            <video
              ref={videoRef}
              className={`w-full rounded-xl bg-black aspect-square object-cover ${cameraOn ? '' : 'hidden'}`}
              muted
              autoPlay
              playsInline
            />
            {cameraOn ? (
              <Button variant="outline" fullWidth size="lg" onClick={stopCamera}>Parar câmera</Button>
            ) : (
              <Button fullWidth size="lg" onClick={startCamera} disabled={!eventId}>
                📷 Ativar câmera
              </Button>
            )}
          </Card>

          <form onSubmit={handleManualSubmit} className="space-y-2">
            <Input
              label="Digite o código do ticket"
              placeholder="TKXXXXXXXXXX"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value.toUpperCase())}
            />
            <Button type="submit" variant="outline" fullWidth loading={loadingTicket}>
              Validar
            </Button>
          </form>
        </>
      )}

      {loadingTicket && <Loading label="Buscando ticket…" />}

      {ticket && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <p className="font-mono font-bold text-lg">{ticket.public_code}</p>
            <span className="text-xs text-ink/50">{ticket.event_name}</span>
          </div>

          {ticket.holder_name && <p className="text-sm text-ink/60">Titular: <b className="text-ink">{ticket.holder_name}</b></p>}
          {ticket.blocked_reason && (
            <p className="rounded-xl bg-danger/10 text-danger text-sm font-medium p-3">{ticket.blocked_reason}</p>
          )}

          {ticket.has_credit && (
            <div className="rounded-2xl border-2 border-primary p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-display font-semibold">💳 Saldo (ficha digital)</p>
                <p className="font-display font-bold text-2xl text-primary-dark">{formatCurrency(Number(ticket.credit_balance))}</p>
              </div>
              {ticket.menu.length === 0 && <p className="text-sm text-ink/50">Nenhum produto cobrável neste ponto.</p>}
              {ticket.menu.map((m) => (
                <div key={m.product_id} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">{m.name}</p>
                    <p className="text-sm text-ink/50">{formatCurrency(Number(m.price))}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button type="button" aria-label={`Diminuir ${m.name}`} onClick={() => updateSpend(m.product_id, -1)}
                      disabled={!(spendQty[m.product_id] > 0)}
                      className="h-14 w-14 rounded-2xl bg-ink/10 text-3xl font-bold leading-none active:scale-90 transition-transform disabled:opacity-30">−</button>
                    <span className="w-8 text-center font-display font-bold text-2xl">{spendQty[m.product_id] || 0}</span>
                    <button type="button" aria-label={`Aumentar ${m.name}`} onClick={() => updateSpend(m.product_id, 1)}
                      disabled={!!ticket.blocked_reason}
                      className="h-14 w-14 rounded-2xl bg-primary text-white text-3xl font-bold leading-none active:scale-90 transition-transform disabled:opacity-30">+</button>
                  </div>
                </div>
              ))}
              {spendTotal > 0 && (
                <p className={`text-sm font-medium ${spendTotal > Number(ticket.credit_balance) ? 'text-danger' : 'text-ink/70'}`}>
                  Total: {formatCurrency(spendTotal)}
                  {spendTotal > Number(ticket.credit_balance) && ' — maior que o saldo'}
                </p>
              )}
              <Button fullWidth size="lg" loading={spending}
                disabled={spendTotal <= 0 || spendTotal > Number(ticket.credit_balance) || !!ticket.blocked_reason}
                onClick={handleSpend}>
                Cobrar {spendTotal > 0 ? formatCurrency(spendTotal) : ''} do saldo
              </Button>
              {lastSpend && (
                <button type="button" onClick={handleUndoSpend} className="text-sm text-primary font-medium underline">
                  Desfazer última cobrança
                </button>
              )}
            </div>
          )}

          {ticket.items.length > 0 && <div className="space-y-3">
            {ticket.items.map((item) => (
              <div key={item.ticket_item_id} className={`border border-line rounded-xl p-4 ${item.deliverable_here === false ? 'opacity-50' : ''}`}>
                <div className="flex justify-between mb-2">
                  <p className="font-semibold">{item.product_name}</p>
                  <p className="text-sm text-ink/50">
                    Comprados: {item.quantity_purchased} · Entregues: {item.quantity_redeemed}
                  </p>
                </div>
                {item.deliverable_here === false && (
                  <p className="text-xs text-danger font-medium mb-2">Não é entregue neste ponto.</p>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm">
                    Disponíveis: <b>{item.available}</b>
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => updateSelection(item.ticket_item_id!, -1, item.available)}
                      className="h-14 w-14 rounded-2xl bg-ink/10 text-3xl font-bold leading-none active:scale-90 transition-transform"
                    >
                      −
                    </button>
                    <span className="w-8 text-center font-display font-bold text-2xl">
                      {selections[item.ticket_item_id!] || 0}
                    </span>
                    <button
                      type="button"
                      onClick={() => updateSelection(item.ticket_item_id!, 1, item.available)}
                      disabled={item.available === 0 || item.deliverable_here === false || !!ticket.blocked_reason}
                      className="h-14 w-14 rounded-2xl bg-primary text-white text-3xl font-bold leading-none active:scale-90 transition-transform disabled:opacity-30"
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>}

          {lastRedemption && (
            <button type="button" onClick={handleUndo} className="text-sm text-primary font-medium underline">
              Desfazer última entrega
            </button>
          )}
          <div className={`grid gap-3 pt-2 ${ticket.items.length > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <Button variant="outline" size="lg" onClick={scanAnother}>Escanear outro</Button>
            {ticket.items.length > 0 && (
              <Button size="lg" loading={confirming} disabled={!!ticket.blocked_reason} onClick={handleConfirmDelivery}>Confirmar entrega</Button>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
