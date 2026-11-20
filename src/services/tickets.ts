import { supabase } from '@/lib/supabaseClient'
import type { MyStation, MyTicket, RedeemResult, SpendResult, ValidationTicket } from '@/types'

export async function getMyTickets(): Promise<MyTicket[]> {
  const { data, error } = await supabase.rpc('get_my_tickets')
  if (error) throw new Error(error.message)
  const fetchedAt = Date.now()
  return (data as Omit<MyTicket, 'fetched_at'>[]).map((t) => ({ ...t, fetched_at: fetchedAt }))
}

export async function getMyStation(eventId: string): Promise<MyStation> {
  const { data, error } = await supabase.rpc('get_my_station', { p_event_id: eventId })
  if (error) throw new Error(error.message)
  return data as MyStation
}

// Valida o QR ao vivo lido pela câmera (assinatura + prazo) e devolve o código do ingresso.
export async function resolveLiveQr(scan: string, eventId: string): Promise<string> {
  const { data, error } = await supabase.rpc('resolve_live_qr', { p_scan: scan, p_event_id: eventId })
  if (error) throw new Error(error.message)
  return data as string
}

export async function getTicketForValidation(publicCode: string, eventId: string): Promise<ValidationTicket> {
  const { data, error } = await supabase.rpc('get_ticket_for_validation', {
    p_public_code: publicCode.trim().toUpperCase(),
    p_event_id: eventId,
  })
  if (error) throw new Error(error.message)
  return data as ValidationTicket
}

// requestId: o MESMO id em repetições da mesma tentativa (toque duplo, rede ruim)
// garante que a baixa só acontece uma vez.
export async function redeemTicketItems(
  publicCode: string,
  eventId: string,
  items: { ticket_item_id: string; quantity: number }[],
  requestId: string,
): Promise<RedeemResult> {
  const { data, error } = await supabase.rpc('redeem_ticket_items', {
    p_public_code: publicCode.trim().toUpperCase(),
    p_event_id: eventId,
    p_items: items,
    p_request_id: requestId,
  })
  if (error) throw new Error(error.message)
  return data as RedeemResult
}

export async function undoRedemption(redemptionId: string): Promise<void> {
  const { error } = await supabase.rpc('undo_redemption', { p_redemption_id: redemptionId })
  if (error) throw new Error(error.message)
}

// Ficha digital: cobra produtos do saldo do cliente. Mesmo requestId = mesma cobrança (idempotente).
export async function spendCredit(
  publicCode: string,
  eventId: string,
  items: { product_id: string; quantity: number }[],
  requestId: string,
): Promise<SpendResult> {
  const { data, error } = await supabase.rpc('spend_credit', {
    p_public_code: publicCode.trim().toUpperCase(),
    p_event_id: eventId,
    p_items: items,
    p_request_id: requestId,
  })
  if (error) throw new Error(error.message)
  return data as SpendResult
}

export async function undoCreditSpend(spendId: string): Promise<void> {
  const { error } = await supabase.rpc('undo_credit_spend', { p_spend_id: spendId })
  if (error) throw new Error(error.message)
}
