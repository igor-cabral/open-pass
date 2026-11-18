import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { listEvents } from '@/services/events'
import { listProductsByEvent } from '@/services/products'
import { createSale, buildClaimUrl } from '@/services/sales'
import { ClaimShare } from '@/components/sales/ClaimShare'
import type { EventItem, Product } from '@/types'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
import { downloadCsv } from '@/utils/export'

const REASONS = ['Equipe', 'Convidado', 'Voluntário', 'Patrocinador']
const MAX_BATCH = 50

interface Issued {
  name: string
  code: string
  token: string
}

function parseMoney(v: string): number {
  const n = Number(v.replace(/\./g, '').replace(',', '.'))
  return isFinite(n) ? Math.round(n * 100) / 100 : 0
}

// Cortesias do admin: gera vários ingressos grátis de uma vez (um por nome),
// cada um com seu próprio link de resgate para enviar a quem for convidado.
export default function CourtesiesPage() {
  const [events, setEvents] = useState<EventItem[] | null>(null)
  const [eventId, setEventId] = useState('')
  const [products, setProducts] = useState<Product[]>([])
  const [quantities, setQuantities] = useState<Record<string, number>>({})
  const [credit, setCredit] = useState('')
  const [reason, setReason] = useState('Convidado')
  const [names, setNames] = useState('')
  const [count, setCount] = useState('1')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<Issued[]>([])
  const [openQr, setOpenQr] = useState<string | null>(null)

  useEffect(() => {
    listEvents()
      .then((evs) => {
        const pub = evs.filter((e) => e.status === 'published')
        setEvents(pub)
        if (pub.length > 0) setEventId(pub[0].id)
      })
      .catch((e) => toast.error(e.message))
  }, [])

  useEffect(() => {
    if (!eventId) return
    listProductsByEvent(eventId).then((l) => setProducts(l.filter((p) => p.active)))
    setQuantities({})
    setCredit('')
  }, [eventId])

  const itemProducts = products.filter((p) => p.kind !== 'credit')
  const creditProduct = products.find((p) => p.kind === 'credit')
  const nameList = names.split('\n').map((n) => n.trim()).filter(Boolean)
  const qty = nameList.length > 0 ? nameList.length : Math.max(0, parseInt(count, 10) || 0)
  const eventName = events?.find((e) => e.id === eventId)?.name || ''

  function setQty(id: string, delta: number) {
    setQuantities((q) => ({ ...q, [id]: Math.max(0, (q[id] || 0) + delta) }))
  }

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault()
    const creditValue = creditProduct ? parseMoney(credit) : 0
    const items: { product_id: string; quantity?: number; amount?: number }[] = [
      ...itemProducts.filter((p) => (quantities[p.id] || 0) > 0).map((p) => ({ product_id: p.id, quantity: quantities[p.id] })),
      ...(creditProduct && creditValue > 0 ? [{ product_id: creditProduct.id, amount: creditValue }] : []),
    ]
    if (items.length === 0) return toast.error('Escolha ao menos um item (ou valor de crédito).')
    if (reason.trim().length < 3) return toast.error('Informe o motivo da cortesia.')
    if (qty < 1) return toast.error('Informe quantos ingressos gerar.')
    if (qty > MAX_BATCH) return toast.error(`No máximo ${MAX_BATCH} por vez.`)

    setBusy(true)
    const done: Issued[] = []
    try {
      for (let i = 0; i < qty; i++) {
        const name = nameList[i] || ''
        const sale = await createSale({
          event_id: eventId,
          items,
          payment_method: 'other',
          payment_status: 'paid',
          buyer_name: name,
          courtesy_reason: reason,
        })
        done.push({ name: name || `Cortesia ${i + 1}`, code: sale.ticket_code, token: sale.claim_token })
        setIssued([...done])
      }
      toast.success(`${done.length} cortesia(s) gerada(s).`)
      setNames('')
    } catch (err) {
      toast.error(
        `${err instanceof Error ? err.message : 'Erro'}${done.length ? ` (${done.length} já gerada(s) abaixo)` : ''}`,
      )
    } finally {
      setBusy(false)
    }
  }

  async function copyAll() {
    const text = issued.map((i) => `${i.name}: ${buildClaimUrl(i.token)}`).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Todos os links copiados!')
    } catch {
      toast.error('Não foi possível copiar.')
    }
  }

  function exportCsv() {
    downloadCsv(`cortesias-${eventName || 'evento'}`, [
      ['Nome', 'Código', 'Motivo', 'Link'],
      ...issued.map((i) => [i.name, i.code, reason, buildClaimUrl(i.token)]),
    ])
  }

  if (!events) return <Loading />

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display font-semibold text-xl">Cortesias</h2>
        <p className="text-sm text-ink/60">
          Gere ingressos gratuitos com motivo registrado e envie o link de resgate a cada convidado.
          Coloque um nome por linha para gerar um ingresso por pessoa.
        </p>
      </div>

      <Card>
        <form onSubmit={handleGenerate} className="space-y-4">
          <Select label="Evento" value={eventId} onChange={(e) => setEventId(e.target.value)}>
            {events.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>

          <div>
            <p className="text-sm font-medium text-ink/70 mb-2">Itens de cada ingresso</p>
            <ul className="space-y-2">
              {itemProducts.length === 0 && <li className="text-sm text-ink/50">Este evento não tem produtos ativos.</li>}
              {itemProducts.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3">
                  <span>{p.name}</span>
                  <span className="flex items-center gap-2">
                    <button type="button" aria-label={`menos ${p.name}`} onClick={() => setQty(p.id, -1)}
                      className="h-10 w-10 rounded-xl border border-line text-xl">−</button>
                    <span className="w-8 text-center font-display font-bold text-lg tabular-nums">{quantities[p.id] || 0}</span>
                    <button type="button" aria-label={`mais ${p.name}`} onClick={() => setQty(p.id, 1)}
                      className="h-10 w-10 rounded-xl bg-primary text-white text-xl">+</button>
                  </span>
                </li>
              ))}
            </ul>
            {creditProduct && (
              <div className="mt-3">
                <Input label={`Crédito de ${creditProduct.name} (R$, opcional)`} inputMode="decimal"
                  value={credit} onChange={(e) => setCredit(e.target.value)} placeholder="0,00" />
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-medium text-ink/70 mb-2">Motivo</p>
            <div className="flex flex-wrap gap-2 mb-2">
              {REASONS.map((r) => (
                <button key={r} type="button" onClick={() => setReason(r)}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border ${reason === r ? 'bg-primary text-white border-primary' : 'border-line'}`}>
                  {r}
                </button>
              ))}
            </div>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} aria-label="Motivo da cortesia" />
          </div>

          <div>
            <label htmlFor="nomes" className="block text-sm font-medium text-ink/70 mb-1.5">
              Nomes dos convidados (um por linha, opcional)
            </label>
            <textarea id="nomes" rows={4} value={names} onChange={(e) => setNames(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface px-4 py-3 text-base outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder={'Maria Silva\nJoão Souza'} />
          </div>
          {nameList.length === 0 && (
            <Input label="Quantidade de ingressos" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
          )}

          <Button type="submit" fullWidth size="lg" loading={busy}>
            Gerar {qty > 0 ? qty : ''} cortesia{qty === 1 ? '' : 's'}
          </Button>
        </form>
      </Card>

      {issued.length > 0 && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h3 className="font-display font-semibold">Links gerados ({issued.length})</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={copyAll}>Copiar todos</Button>
              <Button size="sm" variant="outline" onClick={exportCsv}>Baixar planilha</Button>
            </div>
          </div>
          <p className="text-xs text-ink/60 mb-3">
            Guarde os links agora: por segurança eles não ficam salvos. Se perder um, gere outro em
            Eventos → Pedidos → "Gerar novo link do ingresso" (enquanto não foi resgatado).
          </p>
          <ul className="divide-y divide-line">
            {issued.map((i) => (
              <li key={i.code} className="py-3">
                <div className="flex items-center justify-between gap-2">
                  <span><b>{i.name}</b> <span className="text-xs text-ink/50">· {i.code}</span></span>
                  <button className="text-primary text-sm font-semibold" onClick={() => setOpenQr(openQr === i.code ? null : i.code)}>
                    {openQr === i.code ? 'Fechar' : 'Link / QR'}
                  </button>
                </div>
                {openQr === i.code && <div className="mt-3"><ClaimShare token={i.token} eventName={eventName} /></div>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
