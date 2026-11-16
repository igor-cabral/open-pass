import { supabase } from '@/lib/supabaseClient'
import type { CashierClosing, MySale, PaymentMethod, PaymentStatus, SaleResult } from '@/types'

// O caixa só vende: a venda gera um ticket e um link/QR de resgate. O cliente
// cria a conta (ou entra) pelo link e o ingresso passa a ser dele.
export async function createSale(input: {
  event_id: string
  // produto-ficha usa `amount` (valor do crédito); os demais usam `quantity`
  items: { product_id: string; quantity?: number; amount?: number }[]
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  buyer_name?: string
  courtesy_reason?: string | null // preenchido = cortesia
}): Promise<SaleResult> {
  const { data, error } = await supabase.rpc('create_sale', {
    p_event_id: input.event_id,
    p_items: input.items,
    p_payment_method: input.payment_method,
    p_payment_status: input.payment_status,
    p_buyer_name: input.buyer_name?.trim() || null,
    p_is_courtesy: !!input.courtesy_reason,
    p_courtesy_reason: input.courtesy_reason?.trim() || null,
  })
  if (error) throw new Error(error.message)
  return data as SaleResult
}

// Endereço público que abre a tela de resgate (/t/<token>).
export function buildClaimUrl(token: string): string {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`
  return `${window.location.origin}${base}t/${token}`
}

export async function listMySales(eventId: string): Promise<MySale[]> {
  const { data, error } = await supabase.rpc('list_my_sales', { p_event_id: eventId })
  if (error) throw new Error(error.message)
  return data as MySale[]
}

// Gera um novo link (o anterior deixa de valer). Só para ingressos ainda não resgatados.
export async function regenerateClaimLink(ticketId: string): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_claim_link', { p_ticket_id: ticketId })
  if (error) throw new Error(error.message)
  return (data as { claim_token: string }).claim_token
}

export async function confirmPayment(orderId: string): Promise<void> {
  const { error } = await supabase.rpc('confirm_payment', { p_order_id: orderId })
  if (error) throw new Error(error.message)
}

// Este caixa pode lançar cortesias? (o admin libera por caixa)
export async function canIssueCourtesy(): Promise<boolean> {
  const { data, error } = await supabase.rpc('can_issue_courtesy')
  if (error) return false
  return !!data
}

// Fechamento de caixa do evento. Caixa vê só o próprio; admin vê todos (ou um).
export async function cashierClosing(eventId: string, cashierId?: string): Promise<CashierClosing> {
  const { data, error } = await supabase.rpc('cashier_closing', {
    p_event_id: eventId,
    p_cashier_id: cashierId ?? null,
  })
  if (error) throw new Error(error.message)
  return data as CashierClosing
}
