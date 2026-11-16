import type { CashierClosing, CashierClosingRow } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { formatCurrency, formatDateTime } from '@/utils/format'
import { downloadCsv, numberBR, printReport, type Cell } from '@/utils/export'

const sum = (rows: CashierClosingRow[], k: keyof CashierClosingRow) =>
  rows.reduce((a, r) => a + Number(r[k] || 0), 0)

function methodRows(r: CashierClosingRow | Record<string, number>): [string, number, number][] {
  const x = r as Record<string, number>
  return [
    ['Dinheiro', x.cash_count, x.cash_total],
    ['PIX', x.pix_count, x.pix_total],
    ['Cartão', x.card_count, x.card_total],
    ['Outro', x.other_count, x.other_total],
  ]
}

// Fechamento de caixa: o que cada caixa recebeu por forma de pagamento,
// para conferir o dinheiro na gaveta e o extrato do PIX/cartão no fim da noite.
export function ClosingView({ closing }: { closing: CashierClosing }) {
  const rows = closing.cashiers
  const total = {
    cash_count: sum(rows, 'cash_count'), cash_total: sum(rows, 'cash_total'),
    pix_count: sum(rows, 'pix_count'), pix_total: sum(rows, 'pix_total'),
    card_count: sum(rows, 'card_count'), card_total: sum(rows, 'card_total'),
    other_count: sum(rows, 'other_count'), other_total: sum(rows, 'other_total'),
    paid_total: sum(rows, 'paid_total'), pending_total: sum(rows, 'pending_total'),
    pending_count: sum(rows, 'pending_count'), courtesy_count: sum(rows, 'courtesy_count'),
    courtesy_value: sum(rows, 'courtesy_value'), credit_sold: sum(rows, 'credit_sold'),
    cancelled_count: sum(rows, 'cancelled_count'), cancelled_total: sum(rows, 'cancelled_total'),
  }

  function exportCsv() {
    const out: Cell[][] = [
      ['Fechamento de caixa', closing.event_name, formatDateTime(closing.generated_at)],
      [],
      ['Caixa', 'Dinheiro (qtd)', 'Dinheiro (R$)', 'PIX (qtd)', 'PIX (R$)', 'Cartão (qtd)', 'Cartão (R$)', 'Outro (qtd)', 'Outro (R$)',
       'Total recebido (R$)', 'Pendente (qtd)', 'Pendente (R$)', 'Cortesias (qtd)', 'Cortesias (valor R$)', 'Cancelados (qtd)', 'Crédito vendido (R$)'],
      ...rows.map((r) => [
        r.cashier_name, r.cash_count, numberBR(r.cash_total), r.pix_count, numberBR(r.pix_total), r.card_count, numberBR(r.card_total),
        r.other_count, numberBR(r.other_total), numberBR(r.paid_total), r.pending_count, numberBR(r.pending_total),
        r.courtesy_count, numberBR(r.courtesy_value), r.cancelled_count, numberBR(r.credit_sold),
      ]),
      ['TOTAL', total.cash_count, numberBR(total.cash_total), total.pix_count, numberBR(total.pix_total), total.card_count, numberBR(total.card_total),
       total.other_count, numberBR(total.other_total), numberBR(total.paid_total), total.pending_count, numberBR(total.pending_total),
       total.courtesy_count, numberBR(total.courtesy_value), total.cancelled_count, numberBR(total.credit_sold)],
    ]
    downloadCsv(`fechamento-caixa-${closing.event_name}`, out)
  }

  function exportPdf() {
    printReport('Fechamento de caixa', `${closing.event_name} · ${formatDateTime(closing.generated_at)}`, [
      {
        title: 'Resumo por caixa',
        head: ['Caixa', 'Dinheiro', 'PIX', 'Cartão', 'Outro', 'Total recebido', 'Pendente', 'Cortesias (valor)'],
        rows: [
          ...rows.map((r) => [r.cashier_name, formatCurrency(r.cash_total), formatCurrency(r.pix_total), formatCurrency(r.card_total),
            formatCurrency(r.other_total), formatCurrency(r.paid_total), formatCurrency(r.pending_total), formatCurrency(r.courtesy_value)]),
          ['TOTAL', formatCurrency(total.cash_total), formatCurrency(total.pix_total), formatCurrency(total.card_total),
            formatCurrency(total.other_total), formatCurrency(total.paid_total), formatCurrency(total.pending_total), formatCurrency(total.courtesy_value)],
        ],
      },
      { title: 'Crédito (ficha digital) vendido', rows: [[formatCurrency(total.credit_sold)]] },
      { title: 'Conferência', rows: [['Valor contado na gaveta (dinheiro): ______________'], ['Extrato PIX/cartão conferido: ______________'], ['Responsável: ______________________']] },
    ])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 justify-between items-center">
        <p className="text-xs text-ink/50">Gerado em {formatDateTime(closing.generated_at)}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={rows.length === 0}>Planilha (CSV)</Button>
          <Button size="sm" variant="outline" onClick={exportPdf} disabled={rows.length === 0}>PDF</Button>
        </div>
      </div>

      {rows.length === 0 && <Card className="p-5 text-sm text-ink/60">Nenhuma venda neste evento ainda.</Card>}

      {[...rows, ...(rows.length > 1 ? [{ cashier_id: 'total', cashier_name: 'TOTAL GERAL', ...total } as unknown as CashierClosingRow] : [])].map((r) => (
        <Card key={r.cashier_id} className={`p-4 ${r.cashier_id === 'total' ? 'border-2 border-primary' : ''}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="font-display font-semibold">{r.cashier_name}</p>
            <p className="font-display font-bold text-xl text-primary-dark">{formatCurrency(Number(r.paid_total))}</p>
          </div>
          <div className="divide-y divide-line text-sm">
            {methodRows(r).map(([label, count, amount]) => (
              <div key={label} className="flex justify-between py-1.5">
                <span>{label} <span className="text-ink/50">({Number(count || 0)})</span></span>
                <span className="font-medium">{formatCurrency(Number(amount || 0))}</span>
              </div>
            ))}
            {Number(r.credit_sold) > 0 && (
              <div className="flex justify-between py-1.5 text-ink/70">
                <span>↳ incluso: crédito (ficha digital)</span><span>{formatCurrency(Number(r.credit_sold))}</span>
              </div>
            )}
            {Number(r.pending_count) > 0 && (
              <div className="flex justify-between py-1.5 text-danger">
                <span>Pendente ({Number(r.pending_count)})</span><span>{formatCurrency(Number(r.pending_total))}</span>
              </div>
            )}
            {Number(r.courtesy_count) > 0 && (
              <div className="flex justify-between py-1.5 text-ink/70">
                <span>Cortesias ({Number(r.courtesy_count)})</span><span>valor {formatCurrency(Number(r.courtesy_value))}</span>
              </div>
            )}
            {Number(r.cancelled_count) > 0 && (
              <div className="flex justify-between py-1.5 text-ink/70">
                <span>Cancelados ({Number(r.cancelled_count)})</span><span>{formatCurrency(Number(r.cancelled_total))}</span>
              </div>
            )}
          </div>
        </Card>
      ))}
    </div>
  )
}
