import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import { listProductsByEvent } from '@/services/products'
import { listMyEvents } from '@/services/events'
import { listCashierProducts, listStockStatus, type StockStatus } from '@/services/admin'
import { createSale, canIssueCourtesy } from '@/services/sales'
import { ClaimShare } from '@/components/sales/ClaimShare'
import { useAuth } from '@/contexts/AuthContext'
import type { EventItem, Product, PaymentMethod } from '@/types'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { formatCurrency } from '@/utils/format'
import { Loading } from '@/components/ui/Loading'

interface Receipt {
  ticket_code: string
  total: number
  buyerName: string
  eventName: string
  paymentStatus: 'paid' | 'pending'
  claimToken: string
  isCourtesy: boolean
  credit: number
  value: number
  items: { name: string; quantity: number; credit?: number }[]
}

const QUICK_CREDIT = [10, 20, 50, 100]
const COURTESY_REASONS = ['Equipe', 'Convidado', 'Voluntário', 'Patrocinador']

function parseMoney(v: string): number {
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return isFinite(n) ? Math.round(n * 100) / 100 : 0
}

export default function CashierPage() {
  const { profile } = useAuth()
  const [events, setEvents] = useState<EventItem[] | null>(null)
  const [eventId, setEventId] = useState('')
  const [allowedProductIds, setAllowedProductIds] = useState<string[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [stock, setStock] = useState<Record<string, StockStatus>>({})
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [buyerName, setBuyerName] = useState('')
  const [pending, setPending] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [submitting, setSubmitting] = useState(false)
  const [receipt, setReceipt] = useState<Receipt | null>(null)
  // ficha digital: valor de crédito por produto-ficha e diálogo para digitar
  const [creditAmounts, setCreditAmounts] = useState<Record<string, number>>({})
  const [creditModal, setCreditModal] = useState<string | null>(null)
  const [creditInput, setCreditInput] = useState('')
  const [canCourtesy, setCanCourtesy] = useState(false)
  const [courtesy, setCourtesy] = useState(false)
  const [courtesyReason, setCourtesyReason] = useState('')

  useEffect(() => {
    listMyEvents()
      .then((data) => {
        const published = data.filter((e) => e.status === 'published')
        setEvents(published)
        if (published.length > 0) setEventId(published[0].id)
      })
      .catch((err) => toast.error(err.message))

    // Admin não tem restrição de produtos; só busca a lista pra caixa.
    if (profile?.role === 'cashier') {
      listCashierProducts(profile.id)
        .then(setAllowedProductIds)
        .catch((err) => toast.error(err.message))
    } else {
      setAllowedProductIds([])
    }
  }, [profile?.id, profile?.role])

  useEffect(() => {
    canIssueCourtesy().then(setCanCourtesy)
  }, [profile?.id])

  function reloadStock(evId: string) {
    listStockStatus(evId)
      .then((rows) => {
        const map: Record<string, StockStatus> = {}
        rows.forEach((r) => { map[r.product_id] = r })
        setStock(map)
      })
      .catch((err) => toast.error(err.message))
  }

  useEffect(() => {
    if (!eventId) return
    listProductsByEvent(eventId).then((list) => {
      const active = list.filter((p) => p.active)
      // Lista vazia em allowedProductIds = sem restrição cadastrada.
      const filtered =
        allowedProductIds && allowedProductIds.length > 0
          ? active.filter((p) => allowedProductIds.includes(p.id))
          : active
      setProducts(filtered)
      setQuantities({})
      setCreditAmounts({})
    })
    reloadStock(eventId)
  }, [eventId, allowedProductIds])

  // Quanto ainda dá pra vender deste produto agora (null = sem limite).
  function remainingFor(productId: string): number | null {
    const s = stock[productId]
    if (!s || s.remaining === null) return null
    return s.remaining
  }

  const creditProducts = products.filter((p) => p.kind === 'credit')
  const itemProducts = products.filter((p) => p.kind !== 'credit')
  const creditTotal = Object.values(creditAmounts).reduce((a, b) => a + b, 0)

  const total = useMemo(
    () => itemProducts.reduce((sum, p) => sum + (quantities[p.id] || 0) * p.price, 0) + creditTotal,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [products, quantities, creditTotal],
  )
  const hasItems = Object.values(quantities).some((q) => q > 0) || creditTotal > 0

  function confirmCredit() {
    const v = parseMoney(creditInput)
    if (!creditModal) return
    if (v <= 0) return toast.error('Informe o valor do crédito.')
    if (v > 5000) return toast.error('Valor acima do limite de R$ 5.000.')
    setCreditAmounts((prev) => ({ ...prev, [creditModal]: v }))
    setCreditModal(null)
    setCreditInput('')
  }

  function updateQty(productId: string, delta: number) {
    setQuantities((prev) => {
      const current = prev[productId] || 0
      const remaining = remainingFor(productId)
      const max = remaining === null ? Infinity : remaining
      const next = Math.max(0, Math.min(max, current + delta))
      return { ...prev, [productId]: next }
    })
  }

  async function handleFinish(e: React.FormEvent) {
    e.preventDefault()
    if (!hasItems) {
      toast.error('Selecione ao menos um produto.')
      return
    }
    setSubmitting(true)
    try {
      if (courtesy && courtesyReason.trim().length < 3) {
        toast.error('Informe o motivo da cortesia.')
        setSubmitting(false)
        return
      }
      const items: { product_id: string; quantity?: number; amount?: number }[] = [
        ...itemProducts
          .filter((p) => (quantities[p.id] || 0) > 0)
          .map((p) => ({ product_id: p.id, quantity: quantities[p.id] })),
        ...creditProducts
          .filter((p) => (creditAmounts[p.id] || 0) > 0)
          .map((p) => ({ product_id: p.id, amount: creditAmounts[p.id] })),
      ]

      const sale = await createSale({
        event_id: eventId,
        items,
        payment_method: paymentMethod,
        payment_status: pending ? 'pending' : 'paid',
        buyer_name: buyerName,
        courtesy_reason: courtesy ? courtesyReason : null,
      })

      setReceipt({
        ticket_code: sale.ticket_code,
        total: sale.total,
        buyerName: buyerName.trim(),
        eventName: events?.find((e) => e.id === eventId)?.name || '',
        paymentStatus: sale.payment_status === 'pending' ? 'pending' : 'paid',
        claimToken: sale.claim_token,
        isCourtesy: sale.is_courtesy,
        credit: sale.credit,
        value: sale.value,
        items: [
          ...itemProducts
            .filter((p) => (quantities[p.id] || 0) > 0)
            .map((p) => ({ name: p.name, quantity: quantities[p.id] })),
          ...creditProducts
            .filter((p) => (creditAmounts[p.id] || 0) > 0)
            .map((p) => ({ name: p.name, quantity: 1, credit: creditAmounts[p.id] })),
        ],
      })
      setQuantities({})
      setCreditAmounts({})
      setCourtesy(false)
      setCourtesyReason('')
      setBuyerName('')
      setPending(false)
      reloadStock(eventId)
      toast.success('Venda realizada com sucesso!')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  if (events === null) return <Loading label="Carregando eventos…" />

  if (receipt) {
    return (
      <div className="max-w-md mx-auto">
        <Card className="p-6 text-center">
          <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-primary-light flex items-center justify-center text-2xl">
            ✅
          </div>
          <h2 className="font-display font-bold text-xl mb-1">Venda registrada.</h2>
          <p className="text-ink/60 text-sm mb-5">Ticket: <span className="font-mono font-semibold">{receipt.ticket_code}</span></p>
          <div className="text-left bg-paper rounded-xl p-4 mb-5">
            {receipt.buyerName && <p className="text-sm font-semibold mb-2">{receipt.buyerName}</p>}
            <ul className="text-sm space-y-1 text-ink/70">
              {receipt.items.map((i, idx) => (
                <li key={idx}>{i.credit ? `${i.name}: ${formatCurrency(i.credit)}` : `${i.quantity}x ${i.name}`}</li>
              ))}
            </ul>
            <div className="border-t border-line mt-3 pt-3 flex justify-between font-semibold">
              <span>{receipt.isCourtesy ? 'Cortesia' : 'Total'}</span>
              <span>{formatCurrency(receipt.total)}</span>
            </div>
            {receipt.isCourtesy && (
              <p className="text-xs text-ink/60 mt-1">Valor dos itens: {formatCurrency(receipt.value)} (não entra na receita)</p>
            )}
            {receipt.paymentStatus === 'pending' && (
              <p className="text-xs text-danger mt-2 font-medium">
                Pagamento pendente — o ingresso só libera a entrega depois de confirmado.
              </p>
            )}
          </div>
          <div className="text-left mb-5">
            <p className="text-sm font-semibold mb-3 text-center">Entregue o ingresso ao cliente:</p>
            <ClaimShare token={receipt.claimToken} eventName={receipt.eventName} />
          </div>
          <Button fullWidth onClick={() => setReceipt(null)}>Nova venda</Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto space-y-5">
      <h1 className="font-display font-bold text-2xl">Nova venda</h1>

      <Select label="Evento" value={eventId} onChange={(e) => setEventId(e.target.value)}>
        {events.length === 0 && <option value="">Nenhum evento publicado</option>}
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>{ev.name}</option>
        ))}
      </Select>

      {creditProducts.map((p) => {
        const amount = creditAmounts[p.id] || 0
        return (
          <Card key={p.id} className={`p-4 border-2 ${amount > 0 ? 'border-primary bg-primary-light/50' : 'border-dashed border-line'}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-lg">💳 {p.name}</p>
                <p className="text-sm text-ink/60">
                  {amount > 0 ? <>Crédito: <b className="text-primary-dark">{formatCurrency(amount)}</b></> : 'O cliente gasta o saldo nos pontos de entrega.'}
                </p>
              </div>
              <div className="flex gap-2">
                {amount > 0 && (
                  <button type="button" aria-label="Remover crédito" className="h-12 w-12 rounded-2xl bg-ink/10 text-xl"
                    onClick={() => setCreditAmounts((prev) => { const n = { ...prev }; delete n[p.id]; return n })}>✕</button>
                )}
                <Button type="button" onClick={() => { setCreditModal(p.id); setCreditInput(amount ? String(amount).replace('.', ',') : '') }}>
                  {amount > 0 ? 'Alterar' : 'Adicionar'}
                </Button>
              </div>
            </div>
          </Card>
        )
      })}

      {creditModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/50 p-4" role="dialog" aria-modal="true">
          <Card className="w-full max-w-sm p-5 space-y-4">
            <h2 className="font-display font-bold text-xl">Quanto de crédito?</h2>
            <div className="grid grid-cols-4 gap-2">
              {QUICK_CREDIT.map((v) => (
                <button key={v} type="button" onClick={() => setCreditInput(String(v))}
                  className="h-12 rounded-xl bg-ink/10 font-bold active:scale-95 transition-transform">
                  {v}
                </button>
              ))}
            </div>
            <Input label="Valor (R$)" inputMode="decimal" autoFocus value={creditInput}
              onChange={(e) => setCreditInput(e.target.value)} placeholder="50,00" />
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => { setCreditModal(null); setCreditInput('') }}>Cancelar</Button>
              <Button type="button" onClick={confirmCredit}>Confirmar</Button>
            </div>
          </Card>
        </div>
      )}

      <Card className="p-4 divide-y divide-line">
        {itemProducts.length === 0 && creditProducts.length === 0 && <p className="text-sm text-ink/50 py-4">Nenhum produto ativo para este evento.</p>}
        {itemProducts.map((p) => {
          const remaining = remainingFor(p.id)
          const qty = quantities[p.id] || 0
          const soldOut = remaining !== null && remaining <= 0
          const atMax = remaining !== null && qty >= remaining
          return (
            <div key={p.id} className={`flex items-center justify-between py-4 first:pt-0 last:pb-0 ${qty > 0 ? 'bg-primary-light/50 -mx-4 px-4' : ''}`}>
              <div>
                <p className="font-semibold text-lg">{p.name}</p>
                <p className="text-sm text-ink/50">{formatCurrency(p.price)}</p>
                {remaining !== null && (
                  <p className={`text-xs mt-0.5 font-medium ${soldOut ? 'text-danger' : 'text-primary-dark'}`}>
                    {soldOut ? 'Esgotado' : `${remaining} disponíve${remaining === 1 ? 'l' : 'is'}`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  aria-label={`Diminuir ${p.name}`}
                  onClick={() => updateQty(p.id, -1)}
                  disabled={qty === 0}
                  className="h-14 w-14 rounded-2xl bg-ink/10 text-3xl font-bold leading-none active:scale-90 transition-transform disabled:opacity-30"
                >
                  −
                </button>
                <span className="w-8 text-center font-display font-bold text-2xl">{qty}</span>
                <button
                  type="button"
                  aria-label={`Aumentar ${p.name}`}
                  onClick={() => updateQty(p.id, 1)}
                  disabled={soldOut || atMax}
                  className="h-14 w-14 rounded-2xl bg-primary text-white text-3xl font-bold leading-none active:scale-90 transition-transform disabled:opacity-30"
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
      </Card>

      <Card className="p-4 flex items-center justify-between sticky bottom-3 z-10 shadow-card border border-primary/30">
        <span className="font-display font-semibold">{courtesy ? 'Cortesia' : 'Total'}</span>
        <span className="text-right">
          <span className="font-display font-bold text-3xl text-primary-dark">{formatCurrency(courtesy ? 0 : total)}</span>
          {courtesy && <span className="block text-xs text-ink/60">valor dos itens: {formatCurrency(total)}</span>}
        </span>
      </Card>

      <form onSubmit={handleFinish} className="space-y-4">
        <Card className="p-4 space-y-4">
          <Input
            label="Nome do comprador (opcional)"
            value={buyerName}
            onChange={(e) => setBuyerName(e.target.value)}
            placeholder="Só para você identificar a venda"
          />
          {canCourtesy && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={courtesy} onChange={(e) => setCourtesy(e.target.checked)} />
              🎁 Cortesia (ingresso grátis, com motivo)
            </label>
          )}
          {courtesy ? (
            <div className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {COURTESY_REASONS.map((r) => (
                  <button key={r} type="button" onClick={() => setCourtesyReason(r)}
                    className={`px-3 py-1.5 rounded-full text-sm font-medium border ${courtesyReason === r ? 'bg-primary text-white border-primary' : 'border-line'}`}>
                    {r}
                  </button>
                ))}
              </div>
              <Input label="Motivo da cortesia" value={courtesyReason} onChange={(e) => setCourtesyReason(e.target.value)} maxLength={120} />
            </div>
          ) : (
            <>
              <Select label="Forma de pagamento" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
                <option value="cash">Dinheiro</option>
                <option value="pix">PIX</option>
                <option value="card">Cartão</option>
                <option value="other">Outro</option>
              </Select>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={pending} onChange={(e) => setPending(e.target.checked)} />
                Pagamento ainda não recebido (pendente)
              </label>
            </>
          )}
        </Card>
        <Button type="submit" fullWidth size="lg" loading={submitting} disabled={!eventId || !hasItems}>
          {courtesy ? 'Registrar cortesia' : 'Finalizar venda'}
        </Button>
      </form>
      <p className="text-center">
        <Link to="/caixa/fechamento" className="text-sm text-primary font-medium underline">Fechamento de caixa</Link>
      </p>
    </div>
  )
}
