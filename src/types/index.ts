export type UserRole = 'admin' | 'cashier' | 'validator' | 'customer'
export type EventStatus = 'draft' | 'published' | 'closed' | 'cancelled'
export type PaymentMethod = 'cash' | 'pix' | 'card' | 'other'
export type PaymentStatus = 'paid' | 'pending' | 'cancelled'
export type TicketStatus = 'active' | 'cancelled' | 'fully_redeemed'

export interface Profile {
  id: string
  role: UserRole
  full_name: string
  phone: string | null
  username: string | null
  must_change_password: boolean
  active: boolean
  can_courtesy?: boolean
  created_at: string
}

export interface EventItem {
  id: string
  name: string
  description: string | null
  event_date: string
  event_time: string
  location: string
  status: EventStatus
  created_at: string
  primary_color: string | null
  logo_url: string | null
}

export interface Product {
  id: string
  event_id: string
  name: string
  price: number
  active: boolean
  sort_order: number
  stock_limit: number | null
  kind: 'item' | 'credit'
}

export interface TicketItemView {
  ticket_item_id?: string
  product_name: string
  quantity_purchased: number
  quantity_redeemed: number
  available: number
  // só na tela do validador: este item pode ser entregue no ponto do validador?
  deliverable_here?: boolean
}

export interface MyTicket {
  id: string
  status: TicketStatus
  /** Segredo do QR ao vivo (só no dia do evento). O código fixo do ingresso nunca vai ao cliente. */
  qr_secret: string | null
  /** Hora do servidor (segundos) no momento da resposta, e a hora local em que chegou. */
  server_now: number
  fetched_at: number
  locked: boolean
  ended: boolean
  blocked_reason: string | null
  event_id: string
  event_name: string
  event_date: string
  event_time: string
  location: string
  event_status: EventStatus
  primary_color: string | null
  logo_url: string | null
  credit_balance: number
  has_credit: boolean
  spends: CreditSpendView[]
  items: TicketItemView[]
}

export interface CreditSpendView {
  at: string
  total: number
  station_name: string | null
  items: { name: string; quantity: number }[]
}

export interface ValidationTicket {
  ticket_id: string
  public_code: string
  status: TicketStatus
  event_name: string
  holder_name: string | null
  blocked_reason: string | null
  station_name: string | null
  credit_balance: number
  has_credit: boolean
  menu: { product_id: string; name: string; price: number }[]
  items: TicketItemView[]
}

export interface Station {
  id: string
  event_id: string
  name: string
  active: boolean
  sort_order: number
}

export interface MyStation {
  assigned: boolean
  event_has_stations: boolean
  station_id: string | null
  station_name: string | null
  needs_station: boolean
}

export interface RedeemResult {
  redemption_id: string
  ticket_status: TicketStatus
  duplicate?: boolean
  items: { product_name: string; delivered_now: number; available?: number }[]
}

export interface SaleResult {
  order_id: string
  ticket_id: string
  ticket_code: string
  total: number
  value: number
  credit: number
  is_courtesy: boolean
  payment_status: PaymentStatus
  claim_token: string
}

export interface SpendResult {
  spend_id: string
  total: number
  balance: number
  duplicate?: boolean
  ticket_status: TicketStatus
  items: { product_name: string; quantity: number; unit_price?: number }[]
}

export interface MySale {
  order_id: string
  ticket_id: string
  code_suffix: string
  created_at: string
  total: number
  payment_status: PaymentStatus
  payment_method: PaymentMethod
  order_status: 'active' | 'cancelled'
  buyer_name: string | null
  is_courtesy: boolean
  courtesy_reason: string | null
  claimed: boolean
  customer_name: string | null
  items: { name: string; quantity: number; is_credit: boolean; amount: number }[]
}

export interface ClaimPreview {
  event_name: string
  event_date: string
  event_time: string
  location: string
  logo_url: string | null
  primary_color: string | null
  credit_balance: number
  items: { name: string; quantity: number }[]
}

export interface CartLine {
  product: Product
  quantity: number
}

export interface EventReport {
  totals: {
    total_orders: number
    total_tickets: number
    total_revenue: number
    pending_revenue: number
    unclaimed_tickets: number
    total_items_sold: number
    total_items_delivered: number
    courtesy_count: number
    courtesy_value: number
    credit_sold: number
    credit_spent: number
    credit_outstanding: number
  }
  by_product: { product_name: string; sold: number; delivered: number; remaining: number }[]
  by_cashier: { cashier_name: string; sales_count: number; total_amount: number }[]
  by_validator: { validator_name: string; redemptions_count: number; items_delivered: number }[]
  by_station: { station_name: string; redemptions_count: number; items_delivered: number }[]
  by_method: { method: PaymentMethod; orders_count: number; total: number }[]
  courtesies: { reason: string; orders_count: number; value: number }[]
  credit_by_product: { product_name: string; quantity: number; amount: number }[]
  credit_by_station: { station_name: string; spends_count: number; amount: number }[]
}

export interface CashierClosingRow {
  cashier_id: string
  cashier_name: string
  orders_count: number
  cash_count: number
  cash_total: number
  pix_count: number
  pix_total: number
  card_count: number
  card_total: number
  other_count: number
  other_total: number
  paid_total: number
  pending_count: number
  pending_total: number
  courtesy_count: number
  courtesy_value: number
  cancelled_count: number
  cancelled_total: number
  credit_sold: number
}

export interface CashierClosing {
  event_id: string
  event_name: string
  generated_at: string
  cashiers: CashierClosingRow[]
}

export interface StockAlert {
  event_id: string
  event_name: string
  product_id: string
  product_name: string
  stock_limit: number
  sold: number
  remaining: number
  pct: number
}
export interface LiveDashboard {
  totals: {
    orders: number
    revenue: number
    pending: number
    courtesies: number
    tickets: number
    items_sold: number
    items_delivered: number
    credit_sold: number
    credit_spent: number
    credit_outstanding: number
    server_time: string
  }
  by_product: { product_name: string; stock_limit: number | null; sold: number; delivered: number }[]
  by_station: { station_name: string; items: number }[]
  recent_sales: {
    at: string
    order_number: number
    buyer_name: string
    total: number
    payment_method: string
    payment_status: string
    is_courtesy: boolean
    cashier_name: string
  }[]
  recent_deliveries: { at: string; station_name: string; validator_name: string; summary: string | null; kind: 'item' | 'credit' }[]
  by_hour: { hour: string; orders: number; amount: number }[]
}
