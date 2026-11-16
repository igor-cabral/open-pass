import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { listEvents } from '@/services/events'
import { getEventReport, listOrdersByEvent } from '@/services/admin'
import { cashierClosing } from '@/services/sales'
import { supabase } from '@/lib/supabaseClient'
import type { CashierClosing, EventItem, EventReport } from '@/types'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
import { ClosingView } from '@/components/sales/ClosingView'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { downloadCsv, numberBR, printReport, type Cell, type PrintSection } from '@/utils/export'

const METHOD_LABEL: Record<string, string> = { cash: 'Dinheiro', pix: 'PIX', card: 'Cartão', other: 'Outro' }
const PAY_LABEL: Record<string, string> = { paid: 'Pago', pending: 'Pendente', cancelled: 'Cancelado' }

export default function ReportsPage() {
  const [events, setEvents] = useState<EventItem[]>([])
  const [eventId, setEventId] = useState('')
  const [report, setReport] = useState<EventReport | null>(null)
  const [closing, setClosing] = useState<CashierClosing | null>(null)
  const [tab, setTab] = useState<'resumo' | 'fechamento'>('resumo')
  const [exportingOrders, setExportingOrders] = useState(false)

  useEffect(() => {
    listEvents().then((evs) => {
      setEvents(evs)
      if (evs.length > 0) setEventId(evs[0].id)
    })
  }, [])

  useEffect(() => {
    if (!eventId) return
    setReport(null)
    setClosing(null)
    const load = () => {
      getEventReport(eventId).then(setReport).catch((e) => toast.error(e.message))
      cashierClosing(eventId).then(setClosing).catch(() => {})
    }
    load()

    // Atualiza os números sozinho a cada venda, entrega ou cancelamento deste evento.
    const channel = supabase
      .channel(`report-${eventId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `event_id=eq.${eventId}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'redemptions', filter: `event_id=eq.${eventId}` }, load)
      .subscribe()
    // Reforço (cobranças da ficha digital não têm Realtime): a cada 10s.
    const interval = setInterval(load, 10000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [eventId])

  const eventName = events.find((e) => e.id === eventId)?.name || ''

  function reportSections(r: EventReport): PrintSection[] {
    const t = r.totals
    return [
      {
        title: 'Resumo',
        head: ['Indicador', 'Valor'],
        rows: [
          ['Vendas (pedidos)', t.total_orders], ['Tickets emitidos', t.total_tickets],
          ['Itens vendidos', t.total_items_sold], ['Itens entregues', t.total_items_delivered],
          ['Arrecadado (pago)', formatCurrency(t.total_revenue)], ['A receber (pendente)', formatCurrency(t.pending_revenue)],
          ['Crédito vendido (ficha digital)', formatCurrency(t.credit_sold)], ['Crédito gasto', formatCurrency(t.credit_spent)],
          ['Saldo de crédito em aberto', formatCurrency(t.credit_outstanding)],
          ['Cortesias (qtd)', t.courtesy_count], ['Cortesias (valor)', formatCurrency(t.courtesy_value)],
        ],
      },
      { title: 'Recebido por forma de pagamento', head: ['Forma', 'Vendas', 'Total'],
        rows: r.by_method.map((m) => [METHOD_LABEL[m.method] || m.method, m.orders_count, formatCurrency(m.total)]) },
      { title: 'Produtos', head: ['Produto', 'Vendidos', 'Entregues', 'Restantes'],
        rows: r.by_product.map((p) => [p.product_name, p.sold, p.delivered, p.remaining]) },
      { title: 'Consumo da ficha digital por produto', head: ['Produto', 'Qtd', 'Valor'],
        rows: r.credit_by_product.map((p) => [p.product_name, p.quantity, formatCurrency(p.amount)]) },
      { title: 'Consumo da ficha digital por ponto', head: ['Ponto', 'Cobranças', 'Valor'],
        rows: r.credit_by_station.map((p) => [p.station_name, p.spends_count, formatCurrency(p.amount)]) },
      { title: 'Cortesias por motivo', head: ['Motivo', 'Pedidos', 'Valor'],
        rows: r.courtesies.map((c) => [c.reason, c.orders_count, formatCurrency(c.value)]) },
      { title: 'Vendas por caixa', head: ['Caixa', 'Vendas', 'Total'],
        rows: r.by_cashier.map((c) => [c.cashier_name, c.sales_count, formatCurrency(c.total_amount)]) },
      { title: 'Entregas por ponto', head: ['Ponto', 'Operações', 'Itens'],
        rows: r.by_station.map((c) => [c.station_name, c.redemptions_count, c.items_delivered]) },
      { title: 'Entregas por validador', head: ['Validador', 'Operações', 'Itens'],
        rows: r.by_validator.map((c) => [c.validator_name, c.redemptions_count, c.items_delivered]) },
    ]
  }

  function exportReportCsv() {
    if (!report) return
    const out: Cell[][] = [['Relatório do evento', eventName, formatDateTime(new Date().toISOString())], []]
    for (const sec of reportSections(report)) {
      out.push([sec.title])
      if (sec.head) out.push(sec.head)
      out.push(...sec.rows)
      out.push([])
    }
    downloadCsv(`relatorio-${eventName}`, out)
  }

  function exportReportPdf() {
    if (!report) return
    printReport('Relatório do evento', `${eventName} · ${formatDateTime(new Date().toISOString())}`, reportSections(report))
  }

  // Detalhado: uma linha por item de pedido (para conciliar com o extrato do banco).
  async function exportOrdersCsv() {
    setExportingOrders(true)
    try {
      const orders = await listOrdersByEvent(eventId)
      const out: Cell[][] = [[
        'Data', 'Pedido', 'Situação do pedido', 'Pagamento', 'Forma', 'Comprador/Cliente', 'Telefone', 'E-mail',
        'Cortesia', 'Motivo', 'Item', 'Qtd', 'Valor unit. (R$)', 'Subtotal (R$)', 'Total do pedido (R$)',
      ]]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const o of orders as any[]) {
        const who = o.customers?.profiles?.full_name || o.buyer_name || ''
        for (const it of o.order_items || []) {
          out.push([
            formatDateTime(o.created_at), String(o.id).slice(0, 8), o.status === 'cancelled' ? 'Cancelado' : 'Ativo',
            PAY_LABEL[o.payment_status] || o.payment_status, METHOD_LABEL[o.payment_method] || o.payment_method,
            who, o.customers?.phone || '', o.customers?.email || '',
            o.is_courtesy ? 'Sim' : 'Não', o.courtesy_reason || '',
            it.product_name_snapshot, it.quantity, numberBR(it.unit_price_snapshot), numberBR(it.subtotal), numberBR(o.total),
          ])
        }
      }
      downloadCsv(`pedidos-${eventName}`, out)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setExportingOrders(false)
    }
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <Select label="Evento" value={eventId} onChange={(e) => setEventId(e.target.value)}>
        {events.map((ev) => (
          <option key={ev.id} value={ev.id}>{ev.name}</option>
        ))}
      </Select>

      <div className="flex rounded-xl bg-ink/5 p-1">
        {(['resumo', 'fechamento'] as const).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`flex-1 rounded-lg py-2 text-sm font-semibold ${tab === t ? 'bg-surface shadow-sm' : 'text-ink/50'}`}>
            {t === 'resumo' ? 'Resumo do evento' : 'Fechamento de caixa'}
          </button>
        ))}
      </div>

      {!report ? (
        <Loading label="Carregando relatório…" />
      ) : tab === 'fechamento' ? (
        closing ? <ClosingView closing={closing} /> : <Loading />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={exportReportCsv}>Planilha (CSV)</Button>
            <Button size="sm" variant="outline" onClick={exportReportPdf}>PDF</Button>
            <Button size="sm" variant="outline" loading={exportingOrders} onClick={exportOrdersCsv}>Pedidos detalhados (CSV)</Button>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatCard label="Vendas" value={report.totals.total_orders} />
            <StatCard label="Tickets emitidos" value={report.totals.total_tickets} />
            <StatCard label="Itens vendidos" value={report.totals.total_items_sold} />
            <StatCard label="Itens entregues" value={report.totals.total_items_delivered} />
            <StatCard label="Arrecadado" value={formatCurrency(report.totals.total_revenue)} />
            <StatCard label="A receber (pendente)" value={formatCurrency(report.totals.pending_revenue)} />
            <StatCard label="Ingressos sem dono" value={report.totals.unclaimed_tickets} />
            <StatCard label="Crédito vendido" value={formatCurrency(report.totals.credit_sold)} />
            <StatCard label="Crédito gasto" value={formatCurrency(report.totals.credit_spent)} />
            <StatCard label="Saldo em aberto" value={formatCurrency(report.totals.credit_outstanding)} />
            <StatCard label="Cortesias" value={`${report.totals.courtesy_count} (${formatCurrency(report.totals.courtesy_value)})`} />
          </div>

          <ListCard title="Recebido por forma de pagamento"
            rows={report.by_method.map((m) => [METHOD_LABEL[m.method] || m.method, `${m.orders_count} vendas · ${formatCurrency(m.total)}`])} />

          <Card className="p-5">
            <h3 className="font-display font-semibold mb-3">Produtos</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink/50">
                  <th className="pb-2">Produto</th>
                  <th className="pb-2 text-right">Vendidos</th>
                  <th className="pb-2 text-right">Entregues</th>
                  <th className="pb-2 text-right">Restantes</th>
                </tr>
              </thead>
              <tbody>
                {report.by_product.map((p, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="py-2">{p.product_name}</td>
                    <td className="py-2 text-right">{p.sold}</td>
                    <td className="py-2 text-right">{p.delivered}</td>
                    <td className="py-2 text-right">{p.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <ListCard title="Consumo da ficha digital por produto"
            rows={report.credit_by_product.map((p) => [p.product_name, `${p.quantity}× · ${formatCurrency(p.amount)}`])} />
          <ListCard title="Consumo da ficha digital por ponto"
            rows={report.credit_by_station.map((p) => [p.station_name, `${p.spends_count} cobranças · ${formatCurrency(p.amount)}`])} />
          <ListCard title="Cortesias por motivo"
            rows={report.courtesies.map((c) => [c.reason, `${c.orders_count} · valor ${formatCurrency(c.value)}`])} />
          <ListCard title="Vendas por caixa"
            rows={report.by_cashier.map((c) => [c.cashier_name, `${c.sales_count} vendas · ${formatCurrency(c.total_amount)}`])} />
          <ListCard title="Entregas por ponto"
            rows={(report.by_station || []).map((c) => [c.station_name, `${c.redemptions_count} operações · ${c.items_delivered} itens`])} />
          <ListCard title="Entregas por validador"
            rows={report.by_validator.map((v) => [v.validator_name, `${v.redemptions_count} operações · ${v.items_delivered} itens`])} />
        </div>
      )}
    </div>
  )
}

function ListCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <Card className="p-5">
      <h3 className="font-display font-semibold mb-3">{title}</h3>
      {rows.map(([a, b], i) => (
        <div key={i} className="flex justify-between gap-3 text-sm py-1.5 border-t border-line first:border-0">
          <span>{a}</span>
          <span className="text-right">{b}</span>
        </div>
      ))}
      {rows.length === 0 && <p className="text-sm text-ink/50">Sem dados.</p>}
    </Card>
  )
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-ink/50 mb-1">{label}</p>
      <p className="font-display font-bold text-xl">{value}</p>
    </Card>
  )
}
