// Exportação para prestação de contas — sem bibliotecas externas:
//  * CSV (abre direto no Excel/Google Planilhas; BOM + ";" para o Excel em pt-BR)
//  * PDF via impressão do navegador ("Salvar como PDF")

export type Cell = string | number | null | undefined

function csvCell(v: Cell): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Números saem com vírgula decimal, que é o que o Excel brasileiro entende.
export function numberBR(n: number): string {
  return Number(n || 0).toFixed(2).replace('.', ',')
}

export function downloadCsv(filename: string, rows: Cell[][]) {
  const body = rows.map((r) => r.map(csvCell).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export interface PrintSection {
  title: string
  head?: string[]
  rows: Cell[][]
}

function esc(s: Cell): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

// Abre uma página limpa só com as tabelas e chama a impressão
// (no diálogo escolha "Salvar como PDF").
export function printReport(title: string, subtitle: string, sections: PrintSection[]) {
  const w = window.open('', '_blank')
  if (!w) {
    alert('Permita pop-ups para gerar o PDF.')
    return
  }
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:12px}
  h1{font-size:20px;margin:0 0 2px} .sub{color:#555;margin-bottom:18px}
  h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #ccc;padding:4px 6px;text-align:left}
  th{background:#f2f2f2} td.n{text-align:right} .foot{margin-top:24px;color:#777;font-size:10px}
  @media print{body{margin:10mm}}
</style></head><body>
<h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>
${sections
  .map(
    (s) => `<h2>${esc(s.title)}</h2><table>${
      s.head ? `<thead><tr>${s.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''
    }<tbody>${s.rows
      .map((r) => `<tr>${r.map((c) => `<td class="${typeof c === 'number' ? 'n' : ''}">${esc(c)}</td>`).join('')}</tr>`)
      .join('') || `<tr><td>Sem dados.</td></tr>`}</tbody></table>`,
  )
  .join('')}
<div class="foot">Gerado pelo OpenPass em ${esc(new Date().toLocaleString('pt-BR'))}</div>
<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
</body></html>`
  w.document.open()
  w.document.write(html)
  w.document.close()
}
