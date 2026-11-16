import { supabase } from '@/lib/supabaseClient'
import { callFunction } from '@/lib/api'
import type { EventReport, Profile } from '@/types'

export async function createStaffUser(input: {
  full_name: string
  username: string
  password: string
  role: 'cashier' | 'validator'
}) {
  return callFunction<{ user_id: string; username: string }>('create-staff-user', input, { auth: true })
}

export async function listStaff(role?: 'cashier' | 'validator'): Promise<Profile[]> {
  let query = supabase.from('profiles').select('*').in('role', role ? [role] : ['cashier', 'validator'])
  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) throw error
  return data as Profile[]
}

export async function setUserActive(userId: string, active: boolean) {
  const { error } = await supabase.rpc('admin_set_user_active', { p_user_id: userId, p_active: active })
  if (error) throw new Error(error.message)
}

export async function deleteStaffUser(userId: string) {
  await callFunction('admin-delete-staff-user', { user_id: userId }, { auth: true })
}

const CUSTOMERS_PAGE_SIZE = 50
const CUSTOMER_COLUMNS = 'id, phone, email, created_at, profiles(full_name), orders(id)'

export async function listCustomers(offset = 0, search = '') {
  const term = search.trim()

  if (term) {
    if (term.includes('@')) {
      const { data, error } = await supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .ilike('email', `%${term.replace(/[%,]/g, '')}%`)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    }
    const digits = term.replace(/\D/g, '')
    if (digits.length >= 3) {
      const { data, error } = await supabase
        .from('customers')
        .select(CUSTOMER_COLUMNS)
        .ilike('phone', `%${digits}%`)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    }
    // Busca por nome: o supabase-js não filtra fácil por coluna de tabela
    // aninhada (profiles.full_name) direto no join, então trazemos até 200
    // registros recentes e filtramos o nome no cliente.
    const { data, error } = await supabase
      .from('customers')
      .select(CUSTOMER_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(200)
    if (error) throw error
    const lower = term.toLowerCase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data || []).filter((c: any) => (c.profiles?.full_name || '').toLowerCase().includes(lower))
  }

  const { data, error } = await supabase
    .from('customers')
    .select(CUSTOMER_COLUMNS)
    .order('created_at', { ascending: false })
    .range(offset, offset + CUSTOMERS_PAGE_SIZE - 1)
  if (error) throw error
  return data
}

// --- atribuição de eventos por usuário da equipe ---

export async function listEventStaff(profileId: string): Promise<string[]> {
  const { data, error } = await supabase.from('event_staff').select('event_id').eq('profile_id', profileId)
  if (error) throw error
  return (data || []).map((r) => r.event_id)
}

// Só remove/insere o que mudou, para não apagar o ponto de entrega (station_id)
// de quem continua atribuído ao evento.
export async function setEventStaff(profileId: string, eventIds: string[]) {
  const { data: current, error: curErr } = await supabase
    .from('event_staff')
    .select('event_id')
    .eq('profile_id', profileId)
  if (curErr) throw curErr
  const have = new Set((current || []).map((r) => r.event_id as string))
  const want = new Set(eventIds)

  const toRemove = [...have].filter((id) => !want.has(id))
  const toAdd = [...want].filter((id) => !have.has(id))

  if (toRemove.length) {
    const { error } = await supabase
      .from('event_staff')
      .delete()
      .eq('profile_id', profileId)
      .in('event_id', toRemove)
    if (error) throw error
  }
  if (toAdd.length) {
    const { error } = await supabase
      .from('event_staff')
      .insert(toAdd.map((event_id) => ({ event_id, profile_id: profileId })))
    if (error) throw error
  }
}

// event_id -> station_id (ou null) de um validador
export async function listEventStaffStations(profileId: string): Promise<Record<string, string | null>> {
  const { data, error } = await supabase
    .from('event_staff')
    .select('event_id, station_id')
    .eq('profile_id', profileId)
  if (error) throw error
  const map: Record<string, string | null> = {}
  for (const r of data || []) map[r.event_id as string] = (r.station_id as string | null) ?? null
  return map
}

export async function setStaffStation(profileId: string, eventId: string, stationId: string | null) {
  const { error } = await supabase
    .from('event_staff')
    .update({ station_id: stationId })
    .eq('profile_id', profileId)
    .eq('event_id', eventId)
  if (error) throw error
}

// --- quais produtos um caixa específico pode vender ---
// Sem nenhuma linha cadastrada = sem restrição (vende qualquer produto
// ativo dos eventos atribuídos a ele). Ver supabase/sql/07_sales_limits.sql.

export async function listCashierProducts(profileId: string): Promise<string[]> {
  const { data, error } = await supabase.from('cashier_products').select('product_id').eq('profile_id', profileId)
  if (error) throw error
  return (data || []).map((r) => r.product_id)
}

export async function setCashierProducts(profileId: string, productIds: string[]) {
  const { error: delErr } = await supabase.from('cashier_products').delete().eq('profile_id', profileId)
  if (delErr) throw delErr
  if (productIds.length === 0) return
  const { error: insErr } = await supabase
    .from('cashier_products')
    .insert(productIds.map((product_id) => ({ product_id, profile_id: profileId })))
  if (insErr) throw insErr
}

// --- editar/excluir cliente ---

export async function editCustomer(customerId: string, fullName: string, phone: string, email: string) {
  await callFunction(
    'admin-edit-customer',
    { customer_id: customerId, full_name: fullName, phone, email },
    { auth: true },
  )
}

export async function deleteCustomer(customerId: string) {
  const { error } = await supabase.rpc('admin_delete_customer', { p_customer_id: customerId })
  if (error) throw new Error(error.message)
}

export async function getEventReport(eventId: string): Promise<EventReport> {
  const { data, error } = await supabase.rpc('event_report', { p_event_id: eventId })
  if (error) throw new Error(error.message)
  return data as EventReport
}

export async function cancelOrder(orderId: string) {
  const { error } = await supabase.rpc('admin_cancel_order', { p_order_id: orderId })
  if (error) throw new Error(error.message)
}

export async function reopenTicketItem(ticketItemId: string, quantity: number) {
  const { error } = await supabase.rpc('admin_reopen_ticket_item', {
    p_ticket_item_id: ticketItemId,
    p_quantity: quantity,
  })
  if (error) throw new Error(error.message)
}

export async function listOrdersByEvent(eventId: string) {
  const { data, error } = await supabase
    .from('orders')
    .select('*, customers(phone, email, profiles(full_name)), order_items(*, products(kind)), tickets(id, customer_id, claimed_at)')
    .eq('event_id', eventId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function editOrderItem(orderItemId: string, newQuantity: number) {
  const { error } = await supabase.rpc('admin_edit_order_item', {
    p_order_item_id: orderItemId,
    p_new_quantity: newQuantity,
  })
  if (error) throw new Error(error.message)
}

export async function uncancelOrder(orderId: string) {
  const { error } = await supabase.rpc('admin_uncancel_order', { p_order_id: orderId })
  if (error) throw new Error(error.message)
}

export async function addOrderItem(orderId: string, productId: string, quantity: number) {
  const { error } = await supabase.rpc('admin_add_order_item', {
    p_order_id: orderId,
    p_product_id: productId,
    p_quantity: quantity,
  })
  if (error) throw new Error(error.message)
}

export async function removeOrderItem(orderItemId: string) {
  const { error } = await supabase.rpc('admin_remove_order_item', { p_order_item_id: orderItemId })
  if (error) throw new Error(error.message)
}

// Estoque restante por produto (soma de todas as vendas, não só as do
// caixa logado) — usado na tela de venda pra travar quantidade no limite.
export interface StockStatus {
  product_id: string
  stock_limit: number | null
  sold: number
  remaining: number | null // null = sem limite cadastrado
}

export async function listStockStatus(eventId: string): Promise<StockStatus[]> {
  const { data, error } = await supabase.rpc('list_stock_status', { p_event_id: eventId })
  if (error) throw error
  return data as StockStatus[]
}

// Libera/bloqueia o caixa para lançar cortesias.
export async function setCourtesyPermission(userId: string, allowed: boolean) {
  const { error } = await supabase.rpc('admin_set_courtesy_permission', { p_user_id: userId, p_allowed: allowed })
  if (error) throw new Error(error.message)
}

// Produtos que passaram do limite de aviso (padrão 80% do estoque vendido).
export async function stockAlerts(threshold = 0.8): Promise<import('@/types').StockAlert[]> {
  const { data, error } = await supabase.rpc('stock_alerts', { p_threshold: threshold })
  if (error) throw new Error(error.message)
  return data as import('@/types').StockAlert[]
}
