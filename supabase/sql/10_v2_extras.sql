-- =========================================================================
-- OpenPass v2 — EXTRAS
--   * Ficha digital (crédito): o caixa lança o crédito, o ingresso/QR já
--     nasce com saldo e o validador desconta produtos do saldo no ponto.
--   * Cortesias (ingresso grátis com motivo) com permissão por caixa.
--   * Fechamento de caixa por forma de pagamento.
--   * Alerta de estoque (produto passou de 80% do limite).
--   * Relatório do evento com crédito, cortesias e formas de pagamento.
--
-- [10/12] Execute depois de 08 e 09 e ANTES de 11_v2_hardening.sql. Repetível.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 1) Schema
-- -------------------------------------------------------------------------
alter table public.products add column if not exists kind text not null default 'item';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_kind_check') then
    alter table public.products add constraint products_kind_check check (kind in ('item', 'credit'));
  end if;
end $$;

alter table public.tickets add column if not exists credit_balance numeric(10,2) not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tickets_credit_balance_check') then
    alter table public.tickets add constraint tickets_credit_balance_check check (credit_balance >= 0);
  end if;
end $$;

alter table public.orders
  add column if not exists is_courtesy boolean not null default false,
  add column if not exists courtesy_reason text;

alter table public.profiles add column if not exists can_courtesy boolean not null default false;

create table if not exists public.credit_spends (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets (id),
  event_id uuid not null references public.events (id),
  validator_id uuid not null references public.profiles (id),
  station_id uuid references public.stations (id) on delete set null,
  request_id uuid,
  total numeric(10,2) not null default 0,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_by uuid references public.profiles (id)
);
create index if not exists idx_credit_spends_ticket on public.credit_spends (ticket_id);
create index if not exists idx_credit_spends_event on public.credit_spends (event_id);
create unique index if not exists uq_credit_spends_request
  on public.credit_spends (validator_id, request_id) where request_id is not null;

create table if not exists public.credit_spend_items (
  id uuid primary key default gen_random_uuid(),
  spend_id uuid not null references public.credit_spends (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name_snapshot text not null,
  unit_price_snapshot numeric(10,2) not null,
  quantity int not null check (quantity > 0)
);
create index if not exists idx_credit_spend_items_spend on public.credit_spend_items (spend_id);

alter table public.credit_spends enable row level security;
alter table public.credit_spend_items enable row level security;
revoke all on public.credit_spends from anon, authenticated;
revoke all on public.credit_spend_items from anon, authenticated;

-- -------------------------------------------------------------------------
-- 2) Gatilhos de proteção
-- -------------------------------------------------------------------------
-- Produto "ficha digital": sem preço fixo (o valor é digitado na venda) e sem estoque.
create or replace function public.trg_products_credit()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and new.kind <> old.kind
     and exists (select 1 from public.order_items where product_id = new.id) then
    raise exception 'Não dá para mudar o tipo de um produto que já foi vendido.';
  end if;
  if new.kind = 'credit' then
    new.price := 0;
    new.stock_limit := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_products_credit on public.products;
create trigger trg_products_credit before insert or update on public.products
  for each row execute function public.trg_products_credit();

-- Item de crédito só nasce na venda (create_sale) e depois não se edita nem remove:
-- para corrigir, cancele o pedido e refaça. (Exclusão em cascata do evento é permitida.)
create or replace function public.trg_order_items_credit_guard()
returns trigger
language plpgsql
as $$
declare
  pid uuid;
  is_credit boolean;
begin
  pid := case when tg_op = 'INSERT' then new.product_id else old.product_id end;
  select (kind = 'credit') into is_credit from public.products where id = pid;
  if not coalesce(is_credit, false) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.allow_credit_item', true), '') <> '1' then
      raise exception 'Crédito (ficha digital) só pode ser lançado numa venda no caixa.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old; -- exclusão em cascata (evento/pedido inteiro)
  end if;
  raise exception 'Itens de ficha digital não podem ser editados ou removidos. Cancele o pedido e refaça a venda.';
end;
$$;
drop trigger if exists trg_order_items_credit_guard on public.order_items;
create trigger trg_order_items_credit_guard before insert or update or delete on public.order_items
  for each row execute function public.trg_order_items_credit_guard();

-- Ticket com saldo nunca fica "totalmente utilizado".
create or replace function public.trg_tickets_credit_status()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'fully_redeemed' and new.credit_balance > 0 then
    new.status := 'active';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tickets_credit_status on public.tickets;
create trigger trg_tickets_credit_status before update on public.tickets
  for each row execute function public.trg_tickets_credit_status();

-- -------------------------------------------------------------------------
-- 3) Permissão de cortesia
-- -------------------------------------------------------------------------
create or replace function public.can_issue_courtesy()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.active and (p.role = 'admin' or (p.role = 'cashier' and p.can_courtesy))
       from public.profiles p where p.id = auth.uid()),
    false);
$$;

create or replace function public.admin_set_courtesy_permission(p_user_id uuid, p_allowed boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
begin
  actor := public.require_role(array['admin']::user_role[]);
  update public.profiles set can_courtesy = p_allowed where id = p_user_id and role = 'cashier';
  if not found then
    raise exception 'Caixa não encontrado.';
  end if;
  perform public.log_audit('user.courtesy_permission', jsonb_build_object('user_id', p_user_id, 'allowed', p_allowed));
end;
$$;

-- -------------------------------------------------------------------------
-- 4) VENDA (agora com ficha digital e cortesia)
-- -------------------------------------------------------------------------
drop function if exists public.create_sale(uuid, jsonb, order_payment_method, order_payment_status, text);

create or replace function public.create_sale(
  p_event_id uuid,
  -- [{ "product_id": "...", "quantity": 2 }, ...]
  -- para produto "ficha digital": { "product_id": "...", "amount": 50.00 }
  p_items jsonb,
  p_payment_method order_payment_method default 'cash',
  p_payment_status order_payment_status default 'paid',
  p_buyer_name text default null,
  p_is_courtesy boolean default false,
  p_courtesy_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  ev public.events;
  line record;
  prod public.products;
  running_total numeric(10,2) := 0;
  credit_total numeric(10,2) := 0;
  amt numeric(10,2);
  new_order_id uuid;
  new_ticket_id uuid;
  new_code text;
  code_exists boolean;
  already_sold int;
  claim_token text;
  v_reason text := nullif(left(trim(coalesce(p_courtesy_reason, '')), 120), '');
  v_method order_payment_method := p_payment_method;
  v_status order_payment_status := p_payment_status;
begin
  actor := public.require_role(array['cashier', 'admin']::user_role[]);

  if p_is_courtesy then
    if not public.can_issue_courtesy() then
      raise exception 'Você não tem permissão para lançar cortesias.';
    end if;
    if v_reason is null or length(v_reason) < 3 then
      raise exception 'Informe o motivo da cortesia.';
    end if;
    v_method := 'other';
    v_status := 'paid';
  elsif v_status not in ('paid', 'pending') then
    raise exception 'Situação de pagamento inválida.';
  end if;

  select * into ev from public.events where id = p_event_id for update;
  if ev.id is null then
    raise exception 'Evento não encontrado.';
  end if;
  if ev.status <> 'published' then
    raise exception 'Evento não está disponível para vendas.';
  end if;

  if actor.role = 'cashier'
     and not exists (select 1 from public.event_staff where event_id = p_event_id and profile_id = actor.id) then
    raise exception 'Você não está atribuído a este evento.';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nenhum produto informado.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_items) e where (e->>'product_id') is null) then
    raise exception 'Produto inválido na venda.';
  end if;

  perform set_config('app.allow_credit_item', '1', true);

  new_order_id := gen_random_uuid();
  insert into public.orders (id, event_id, customer_id, cashier_id, payment_method, payment_status, total, buyer_name,
                             is_courtesy, courtesy_reason)
  values (new_order_id, p_event_id, null, actor.id, v_method, v_status, 0,
          nullif(left(trim(coalesce(p_buyer_name, '')), 80), ''),
          p_is_courtesy, case when p_is_courtesy then v_reason else null end);

  loop
    new_code := public.generate_ticket_code();
    select exists (select 1 from public.tickets where public_code = new_code) into code_exists;
    exit when not code_exists;
  end loop;

  claim_token := public.generate_claim_token();
  new_ticket_id := gen_random_uuid();
  insert into public.tickets (id, public_code, order_id, event_id, customer_id, status, claim_token_hash)
  values (new_ticket_id, new_code, new_order_id, p_event_id, null, 'active', public.claim_token_hash(claim_token));

  for line in
    select (e->>'product_id')::uuid as product_id,
           sum(coalesce((e->>'quantity')::int, 0))::int as qty,
           sum(coalesce((e->>'amount')::numeric, 0)) as amount
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    select * into prod from public.products where id = line.product_id and event_id = p_event_id for update;
    if prod.id is null then
      raise exception 'Produto não encontrado neste evento.';
    end if;
    if not prod.active then
      raise exception 'Produto "%": está inativo.', prod.name;
    end if;

    if actor.role = 'cashier'
       and exists (select 1 from public.cashier_products where profile_id = actor.id)
       and not exists (select 1 from public.cashier_products where profile_id = actor.id and product_id = prod.id)
    then
      raise exception 'Você não tem permissão para vender "%".', prod.name;
    end if;

    if prod.kind = 'credit' then
      amt := round(line.amount, 2);
      if amt is null or amt <= 0 then
        raise exception 'Informe o valor do crédito.';
      end if;
      if amt > 5000 then
        raise exception 'Valor de crédito acima do limite (R$ 5.000).';
      end if;
      insert into public.order_items (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, subtotal)
      values (new_order_id, prod.id, prod.name, amt, 1, amt);
      credit_total := credit_total + amt;
      running_total := running_total + amt;
    else
      if line.qty <= 0 then
        raise exception 'Quantidade inválida para um dos produtos.';
      end if;

      if prod.stock_limit is not null then
        select coalesce(sum(ti.quantity_purchased), 0) into already_sold
        from public.ticket_items ti
        join public.tickets tk on tk.id = ti.ticket_id
        where ti.product_id = prod.id and tk.status <> 'cancelled';

        if already_sold + line.qty > prod.stock_limit then
          raise exception 'Estoque insuficiente para "%": restam % (pediu %).',
            prod.name, greatest(prod.stock_limit - already_sold, 0), line.qty;
        end if;
      end if;

      insert into public.order_items (order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity, subtotal)
      values (new_order_id, prod.id, prod.name, prod.price, line.qty, prod.price * line.qty);

      insert into public.ticket_items (ticket_id, product_id, product_name_snapshot, quantity_purchased, quantity_redeemed)
      values (new_ticket_id, prod.id, prod.name, line.qty, 0);

      running_total := running_total + (prod.price * line.qty);
    end if;
  end loop;

  perform set_config('app.allow_credit_item', '', true);

  if credit_total > 0 then
    update public.tickets set credit_balance = credit_total where id = new_ticket_id;
  end if;
  -- cortesia: o valor "doado" fica nos itens do pedido, mas não entra como receita
  update public.orders set total = case when p_is_courtesy then 0 else running_total end where id = new_order_id;

  perform public.log_audit('sale.create', jsonb_build_object(
    'order_id', new_order_id, 'ticket_id', new_ticket_id, 'event_id', p_event_id,
    'total', case when p_is_courtesy then 0 else running_total end,
    'payment_status', v_status, 'credit', credit_total
  ));
  if p_is_courtesy then
    perform public.log_audit('sale.courtesy', jsonb_build_object(
      'order_id', new_order_id, 'event_id', p_event_id, 'value', running_total, 'reason', v_reason
    ));
  end if;

  return jsonb_build_object(
    'order_id', new_order_id,
    'ticket_id', new_ticket_id,
    'ticket_code', new_code,
    'total', case when p_is_courtesy then 0 else running_total end,
    'value', running_total,
    'credit', credit_total,
    'is_courtesy', p_is_courtesy,
    'payment_status', v_status,
    'claim_token', claim_token
  );
end;
$$;

-- Histórico de vendas do caixa (agora com crédito / cortesia)
create or replace function public.list_my_sales(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  result jsonb;
begin
  actor := public.require_role(array['cashier', 'admin']::user_role[]);

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into result
  from (
    select
      o.id as order_id,
      tk.id as ticket_id,
      right(tk.public_code, 4) as code_suffix,
      o.created_at,
      o.total,
      o.payment_status,
      o.payment_method,
      o.status as order_status,
      o.buyer_name,
      o.is_courtesy,
      o.courtesy_reason,
      (tk.customer_id is not null) as claimed,
      pr.full_name as customer_name,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
                 'name', oi.product_name_snapshot, 'quantity', oi.quantity,
                 'is_credit', (p.kind = 'credit'), 'amount', oi.subtotal)
               order by oi.created_at), '[]'::jsonb)
        from public.order_items oi
        left join public.products p on p.id = oi.product_id
        where oi.order_id = o.id
      ) as items
    from public.orders o
    join public.tickets tk on tk.order_id = o.id
    left join public.profiles pr on pr.id = tk.customer_id
    where o.event_id = p_event_id
      and (actor.role = 'admin' or o.cashier_id = actor.id)
    order by o.created_at desc
    limit 100
  ) t;

  return result;
end;
$$;

-- -------------------------------------------------------------------------
-- 5) Resgate / visão do cliente / visão do validador (com saldo)
-- -------------------------------------------------------------------------
create or replace function public.peek_claim(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  tk public.tickets;
  ev public.events;
begin
  select * into tk from public.tickets where claim_token_hash = p_token_hash and customer_id is null;
  if tk.id is null then
    raise exception 'Link inválido ou já utilizado.';
  end if;
  if tk.status = 'cancelled' then
    raise exception 'Este ingresso foi cancelado.';
  end if;
  select * into ev from public.events where id = tk.event_id;

  return jsonb_build_object(
    'event_name', ev.name,
    'event_date', ev.event_date,
    'event_time', ev.event_time,
    'location', ev.location,
    'logo_url', ev.logo_url,
    'primary_color', ev.primary_color,
    'credit_balance', tk.credit_balance,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object('name', ti.product_name_snapshot, 'quantity', ti.quantity_purchased)
                                order by ti.created_at), '[]'::jsonb)
      from public.ticket_items ti where ti.ticket_id = tk.id
    )
  );
end;
$$;

create or replace function public.get_my_tickets()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  result jsonb;
begin
  actor := public.require_role(array['customer', 'admin']::user_role[]);

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', x.id,
      'status', x.status,
      'public_code', case
        when x.status = 'active' and x.blocked_reason is null and not x.locked and not x.ended then x.raw_code
        else null end,
      'locked', x.locked,
      'ended', x.ended,
      'blocked_reason', x.blocked_reason,
      'event_id', x.event_id,
      'event_name', x.event_name,
      'event_date', x.event_date,
      'event_time', x.event_time,
      'location', x.location,
      'event_status', x.event_status,
      'primary_color', x.primary_color,
      'logo_url', x.logo_url,
      'credit_balance', x.credit_balance,
      'has_credit', x.has_credit,
      'spends', x.spends,
      'items', x.items
    ) order by x.event_date desc, x.created_at desc
  ), '[]'::jsonb) into result
  from (
    select
      tk.id, tk.status, tk.public_code as raw_code, tk.created_at, tk.credit_balance,
      ev.id as event_id, ev.name as event_name, ev.event_date, ev.event_time, ev.location,
      ev.status as event_status, ev.primary_color, ev.logo_url,
      public.ticket_block_reason(tk.id) as blocked_reason,
      (public.today_br() < ev.event_date) as locked,
      (public.today_br() >= ev.event_date and not public.event_is_operational(ev.event_date)) as ended,
      (tk.credit_balance > 0 or exists (select 1 from public.credit_spends cs where cs.ticket_id = tk.id)
        or exists (select 1 from public.order_items oi join public.products pp on pp.id = oi.product_id
                   where oi.order_id = tk.order_id and pp.kind = 'credit')) as has_credit,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'at', cs.created_at,
          'total', cs.total,
          'station_name', st.name,
          'items', (select coalesce(jsonb_agg(jsonb_build_object('name', csi.product_name_snapshot, 'quantity', csi.quantity)), '[]'::jsonb)
                    from public.credit_spend_items csi where csi.spend_id = cs.id)
        ) order by cs.created_at desc), '[]'::jsonb)
        from public.credit_spends cs
        left join public.stations st on st.id = cs.station_id
        where cs.ticket_id = tk.id and cs.undone_at is null
      ) as spends,
      (
        select coalesce(jsonb_agg(jsonb_build_object(
          'product_name', ti.product_name_snapshot,
          'quantity_purchased', ti.quantity_purchased,
          'quantity_redeemed', ti.quantity_redeemed,
          'available', ti.quantity_purchased - ti.quantity_redeemed
        ) order by ti.created_at), '[]'::jsonb)
        from public.ticket_items ti where ti.ticket_id = tk.id
      ) as items
    from public.tickets tk
    join public.events ev on ev.id = tk.event_id
    where tk.customer_id = actor.id
  ) x;

  return result;
end;
$$;

create or replace function public.get_ticket_for_validation(p_public_code text, p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  tk public.tickets;
  ev public.events;
  sc jsonb;
  restricted boolean;
  v_station_id uuid;
  holder text;
  items jsonb;
  menu jsonb := '[]'::jsonb;
  v_has_credit boolean;
begin
  actor := public.require_role(array['validator', 'admin']::user_role[]);

  select * into ev from public.events where id = p_event_id;
  if ev.id is null then
    raise exception 'Evento não encontrado.';
  end if;
  if ev.status in ('cancelled', 'draft') then
    raise exception 'Evento encerrado.';
  end if;
  if not public.event_is_operational(ev.event_date) then
    raise exception 'Este evento não está acontecendo hoje.';
  end if;

  sc := public.validator_scope(actor.id, actor.role, p_event_id);
  if not (sc->>'assigned')::boolean then
    raise exception 'Você não está atribuído a este evento.';
  end if;
  restricted := (sc->>'restricted')::boolean;
  v_station_id := nullif(sc->>'station_id', '')::uuid;
  if restricted and v_station_id is null then
    raise exception 'Você ainda não foi atribuído a um ponto de entrega neste evento. Fale com o administrador.';
  end if;
  if restricted and not (sc->>'station_active')::boolean then
    raise exception 'Seu ponto de entrega está desativado.';
  end if;

  select * into tk from public.tickets where public_code = upper(trim(p_public_code));
  if tk.id is null then
    raise exception 'Ticket não encontrado.';
  end if;
  if tk.event_id <> p_event_id then
    raise exception 'Ticket pertence a outro evento.';
  end if;

  select coalesce(pr.full_name, o.buyer_name) into holder
  from public.orders o
  left join public.profiles pr on pr.id = tk.customer_id
  where o.id = tk.order_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'ticket_item_id', ti.id,
    'product_name', ti.product_name_snapshot,
    'quantity_purchased', ti.quantity_purchased,
    'quantity_redeemed', ti.quantity_redeemed,
    'available', ti.quantity_purchased - ti.quantity_redeemed,
    'deliverable_here', (
      not restricted
      or (v_station_id is not null and exists (
        select 1 from public.station_products sp
        where sp.station_id = v_station_id and sp.product_id = ti.product_id
      ))
    )
  ) order by ti.created_at), '[]'::jsonb) into items
  from public.ticket_items ti where ti.ticket_id = tk.id;

  v_has_credit := tk.credit_balance > 0
    or exists (select 1 from public.credit_spends cs where cs.ticket_id = tk.id)
    or exists (select 1 from public.order_items oi join public.products pp on pp.id = oi.product_id
               where oi.order_id = tk.order_id and pp.kind = 'credit');

  if v_has_credit then
    select coalesce(jsonb_agg(jsonb_build_object('product_id', p.id, 'name', p.name, 'price', p.price)
                              order by p.sort_order, p.name), '[]'::jsonb) into menu
    from public.products p
    where p.event_id = p_event_id and p.active and p.kind = 'item'
      and (not restricted or exists (
        select 1 from public.station_products sp where sp.station_id = v_station_id and sp.product_id = p.id));
  end if;

  return jsonb_build_object(
    'ticket_id', tk.id,
    'public_code', tk.public_code,
    'status', tk.status,
    'event_name', ev.name,
    'holder_name', holder,
    'blocked_reason', public.ticket_block_reason(tk.id),
    'station_name', sc->>'station_name',
    'credit_balance', tk.credit_balance,
    'has_credit', v_has_credit,
    'menu', menu,
    'items', items
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 6) Cobrar do saldo (ficha digital) e desfazer
-- -------------------------------------------------------------------------
create or replace function public.spend_credit(
  p_public_code text,
  p_event_id uuid,
  p_items jsonb,                 -- [{ "product_id": "uuid", "quantity": 2 }, ...]
  p_request_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  tk public.tickets;
  ev public.events;
  sc jsonb;
  restricted boolean;
  v_station_id uuid;
  prev public.credit_spends;
  line record;
  prod public.products;
  v_total numeric(10,2) := 0;
  new_spend_id uuid;
  new_balance numeric(10,2);
  remaining_items int;
  reason text;
  items_out jsonb := '[]'::jsonb;
begin
  actor := public.require_role(array['validator', 'admin']::user_role[]);

  if p_request_id is not null then
    select * into prev from public.credit_spends where validator_id = actor.id and request_id = p_request_id;
    if prev.id is not null then
      return jsonb_build_object(
        'spend_id', prev.id, 'total', prev.total, 'duplicate', true,
        'balance', (select credit_balance from public.tickets where id = prev.ticket_id),
        'ticket_status', (select status from public.tickets where id = prev.ticket_id),
        'items', (select coalesce(jsonb_agg(jsonb_build_object('product_name', product_name_snapshot, 'quantity', quantity)), '[]'::jsonb)
                  from public.credit_spend_items where spend_id = prev.id)
      );
    end if;
  end if;

  select * into ev from public.events where id = p_event_id;
  if ev.id is null then
    raise exception 'Evento não encontrado.';
  end if;
  if ev.status in ('cancelled', 'draft') then
    raise exception 'Evento encerrado.';
  end if;
  if not public.event_is_operational(ev.event_date) then
    raise exception 'Este evento não está acontecendo hoje.';
  end if;

  sc := public.validator_scope(actor.id, actor.role, p_event_id);
  if not (sc->>'assigned')::boolean then
    raise exception 'Você não está atribuído a este evento.';
  end if;
  restricted := (sc->>'restricted')::boolean;
  v_station_id := nullif(sc->>'station_id', '')::uuid;
  if restricted and v_station_id is null then
    raise exception 'Você ainda não foi atribuído a um ponto de entrega neste evento. Fale com o administrador.';
  end if;
  if restricted and not (sc->>'station_active')::boolean then
    raise exception 'Seu ponto de entrega está desativado.';
  end if;

  select * into tk from public.tickets where public_code = upper(trim(p_public_code)) for update;
  if tk.id is null then
    raise exception 'Ticket não encontrado.';
  end if;
  if tk.event_id <> p_event_id then
    raise exception 'Ticket pertence a outro evento.';
  end if;
  reason := public.ticket_block_reason(tk.id);
  if reason is not null then
    raise exception '%', reason;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Nenhum produto selecionado.';
  end if;

  new_spend_id := gen_random_uuid();
  insert into public.credit_spends (id, ticket_id, event_id, validator_id, station_id, request_id, total)
  values (new_spend_id, tk.id, p_event_id, actor.id, v_station_id, p_request_id, 0);

  for line in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::int)::int as qty
    from jsonb_array_elements(p_items) e
    group by 1
    order by 1
  loop
    if line.qty is null or line.qty <= 0 then
      raise exception 'Quantidade inválida.';
    end if;
    select * into prod from public.products where id = line.product_id and event_id = p_event_id;
    if prod.id is null then
      raise exception 'Produto não encontrado neste evento.';
    end if;
    if not prod.active then
      raise exception 'Produto "%": está inativo.', prod.name;
    end if;
    if prod.kind <> 'item' then
      raise exception '"%" não pode ser cobrado do saldo.', prod.name;
    end if;
    if restricted and not exists (
      select 1 from public.station_products sp where sp.station_id = v_station_id and sp.product_id = prod.id
    ) then
      raise exception '"%" não é vendido neste ponto.', prod.name;
    end if;

    v_total := v_total + prod.price * line.qty;
    insert into public.credit_spend_items (spend_id, product_id, product_name_snapshot, unit_price_snapshot, quantity)
    values (new_spend_id, prod.id, prod.name, prod.price, line.qty);
    items_out := items_out || jsonb_build_object('product_name', prod.name, 'quantity', line.qty, 'unit_price', prod.price);
  end loop;

  if v_total <= 0 then
    raise exception 'Nada a cobrar.';
  end if;
  if tk.credit_balance < v_total then
    raise exception 'Saldo insuficiente: R$ % (total R$ %).',
      replace(to_char(tk.credit_balance, 'FM999990.00'), '.', ','),
      replace(to_char(v_total, 'FM999990.00'), '.', ',');
  end if;

  update public.tickets set credit_balance = credit_balance - v_total
    where id = tk.id returning credit_balance into new_balance;
  update public.credit_spends set total = v_total where id = new_spend_id;

  select coalesce(sum(quantity_purchased - quantity_redeemed), 0) into remaining_items
  from public.ticket_items where ticket_id = tk.id;
  if new_balance = 0 and remaining_items = 0 then
    update public.tickets set status = 'fully_redeemed' where id = tk.id;
  end if;

  perform public.log_audit('credit.spend', jsonb_build_object(
    'ticket_id', tk.id, 'spend_id', new_spend_id, 'station_id', v_station_id, 'total', v_total, 'items', p_items
  ));

  return jsonb_build_object(
    'spend_id', new_spend_id,
    'total', v_total,
    'balance', new_balance,
    'ticket_status', (select status from public.tickets where id = tk.id),
    'items', items_out
  );
end;
$$;

create or replace function public.undo_credit_spend(p_spend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  cs public.credit_spends;
begin
  actor := public.require_role(array['validator', 'admin']::user_role[]);

  select * into cs from public.credit_spends where id = p_spend_id for update;
  if cs.id is null then
    raise exception 'Cobrança não encontrada.';
  end if;
  if cs.undone_at is not null then
    raise exception 'Esta cobrança já foi desfeita.';
  end if;
  if actor.role = 'validator'
     and (cs.validator_id <> actor.id or cs.created_at < now() - interval '3 minutes') then
    raise exception 'Só é possível desfazer a sua própria cobrança nos primeiros 3 minutos.';
  end if;

  perform 1 from public.tickets where id = cs.ticket_id for update;
  update public.tickets set credit_balance = credit_balance + cs.total where id = cs.ticket_id;
  update public.tickets set status = 'active' where id = cs.ticket_id and status = 'fully_redeemed';
  update public.credit_spends set undone_at = now(), undone_by = actor.id where id = cs.id;

  perform public.log_audit('credit.spend_undo', jsonb_build_object('spend_id', cs.id, 'ticket_id', cs.ticket_id, 'total', cs.total));
  return jsonb_build_object('ok', true, 'balance', (select credit_balance from public.tickets where id = cs.ticket_id));
end;
$$;

-- -------------------------------------------------------------------------
-- 7) Fechamento de caixa
-- -------------------------------------------------------------------------
create or replace function public.cashier_closing(p_event_id uuid, p_cashier_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  cid uuid;
  rows jsonb;
begin
  actor := public.require_role(array['cashier', 'admin']::user_role[]);
  if actor.role = 'cashier' then
    cid := actor.id;
    if not exists (select 1 from public.event_staff where event_id = p_event_id and profile_id = actor.id) then
      raise exception 'Você não está atribuído a este evento.';
    end if;
  else
    cid := p_cashier_id;
  end if;

  with ov as (
    select oi.order_id,
           sum(oi.subtotal) as value,
           coalesce(sum(oi.subtotal) filter (where p.kind = 'credit'), 0) as credit_value
    from public.order_items oi
    left join public.products p on p.id = oi.product_id
    group by oi.order_id
  )
  select coalesce(jsonb_agg(to_jsonb(t) order by t.cashier_name), '[]'::jsonb) into rows
  from (
    select
      o.cashier_id,
      pr.full_name as cashier_name,
      count(*) filter (where o.status <> 'cancelled') as orders_count,
      count(*) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'cash') as cash_count,
      coalesce(sum(o.total) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'cash'), 0) as cash_total,
      count(*) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'pix') as pix_count,
      coalesce(sum(o.total) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'pix'), 0) as pix_total,
      count(*) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'card') as card_count,
      coalesce(sum(o.total) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'card'), 0) as card_total,
      count(*) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'other') as other_count,
      coalesce(sum(o.total) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy and o.payment_method = 'other'), 0) as other_total,
      coalesce(sum(o.total) filter (where o.status <> 'cancelled' and o.payment_status = 'paid'), 0) as paid_total,
      count(*) filter (where o.status <> 'cancelled' and o.payment_status = 'pending') as pending_count,
      coalesce(sum(o.total) filter (where o.status <> 'cancelled' and o.payment_status = 'pending'), 0) as pending_total,
      count(*) filter (where o.status <> 'cancelled' and o.is_courtesy) as courtesy_count,
      coalesce(sum(ov.value) filter (where o.status <> 'cancelled' and o.is_courtesy), 0) as courtesy_value,
      count(*) filter (where o.status = 'cancelled') as cancelled_count,
      coalesce(sum(o.total) filter (where o.status = 'cancelled'), 0) as cancelled_total,
      coalesce(sum(ov.credit_value) filter (where o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy), 0) as credit_sold
    from public.orders o
    join public.profiles pr on pr.id = o.cashier_id
    left join ov on ov.order_id = o.id
    where o.event_id = p_event_id and (cid is null or o.cashier_id = cid)
    group by o.cashier_id, pr.full_name
  ) t;

  return jsonb_build_object(
    'event_id', p_event_id,
    'event_name', (select name from public.events where id = p_event_id),
    'generated_at', now(),
    'cashiers', rows
  );
end;
$$;

-- -------------------------------------------------------------------------
-- 8) Alerta de estoque (admin): produtos acima do limite de aviso
-- -------------------------------------------------------------------------
create or replace function public.stock_alerts(p_threshold numeric default 0.8)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  perform public.require_role(array['admin']::user_role[]);

  select coalesce(jsonb_agg(to_jsonb(a) order by a.pct desc), '[]'::jsonb) into result
  from (
    select
      ev.id as event_id, ev.name as event_name,
      p.id as product_id, p.name as product_name,
      p.stock_limit, s.sold::int as sold,
      greatest(p.stock_limit - s.sold, 0)::int as remaining,
      round(s.sold::numeric / p.stock_limit * 100)::int as pct
    from public.products p
    join public.events ev on ev.id = p.event_id
    cross join lateral (
      select coalesce(sum(ti.quantity_purchased), 0) as sold
      from public.ticket_items ti
      join public.tickets tk on tk.id = ti.ticket_id
      where ti.product_id = p.id and tk.status <> 'cancelled'
    ) s
    where p.stock_limit is not null and p.stock_limit > 0 and p.active and p.kind = 'item'
      and ev.status = 'published' and ev.event_date >= public.today_br() - 1
      and s.sold >= p.stock_limit * greatest(least(p_threshold, 1), 0.01)
  ) a;

  return result;
end;
$$;

-- -------------------------------------------------------------------------
-- 9) Relatório do evento (v3: crédito, cortesias, formas de pagamento)
-- -------------------------------------------------------------------------
create or replace function public.event_report(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  by_product jsonb;
  by_cashier jsonb;
  by_validator jsonb;
  by_station jsonb;
  by_method jsonb;
  courtesies jsonb;
  credit_by_product jsonb;
  credit_by_station jsonb;
  totals jsonb;
begin
  actor := public.require_role(array['admin']::user_role[]);

  select coalesce(jsonb_agg(row_to_json(p)), '[]'::jsonb) into by_product from (
    select
      ti.product_name_snapshot as product_name,
      sum(ti.quantity_purchased) as sold,
      sum(ti.quantity_redeemed) as delivered,
      sum(ti.quantity_purchased - ti.quantity_redeemed) as remaining
    from public.ticket_items ti
    join public.tickets tk on tk.id = ti.ticket_id
    where tk.event_id = p_event_id and tk.status <> 'cancelled'
    group by ti.product_name_snapshot
    order by ti.product_name_snapshot
  ) p;

  select coalesce(jsonb_agg(row_to_json(c)), '[]'::jsonb) into by_cashier from (
    select pr.full_name as cashier_name, count(o.id) as sales_count, sum(o.total) as total_amount
    from public.orders o
    join public.profiles pr on pr.id = o.cashier_id
    where o.event_id = p_event_id and o.status <> 'cancelled' and o.payment_status = 'paid' and not o.is_courtesy
    group by pr.full_name
    order by total_amount desc
  ) c;

  select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb) into by_validator from (
    select name as validator_name, sum(ops)::int as redemptions_count, sum(items)::int as items_delivered
    from (
      select pr.full_name as name, count(distinct r.id) as ops, sum(ri.quantity) as items
      from public.redemptions r
      join public.profiles pr on pr.id = r.validator_id
      join public.redemption_items ri on ri.redemption_id = r.id
      where r.event_id = p_event_id and r.undone_at is null
      group by pr.full_name
      union all
      select pr.full_name, count(distinct cs.id), sum(csi.quantity)
      from public.credit_spends cs
      join public.profiles pr on pr.id = cs.validator_id
      join public.credit_spend_items csi on csi.spend_id = cs.id
      where cs.event_id = p_event_id and cs.undone_at is null
      group by pr.full_name
    ) u
    group by name
    order by items_delivered desc
  ) v;

  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) into by_station from (
    select station_name, sum(ops)::int as redemptions_count, sum(items)::int as items_delivered
    from (
      select coalesce(st.name, '(sem ponto)') as station_name, count(distinct r.id) as ops, sum(ri.quantity) as items
      from public.redemptions r
      join public.redemption_items ri on ri.redemption_id = r.id
      left join public.stations st on st.id = r.station_id
      where r.event_id = p_event_id and r.undone_at is null
      group by coalesce(st.name, '(sem ponto)')
      union all
      select coalesce(st.name, '(sem ponto)'), count(distinct cs.id), sum(csi.quantity)
      from public.credit_spends cs
      join public.credit_spend_items csi on csi.spend_id = cs.id
      left join public.stations st on st.id = cs.station_id
      where cs.event_id = p_event_id and cs.undone_at is null
      group by coalesce(st.name, '(sem ponto)')
    ) u
    group by station_name
    order by items_delivered desc
  ) s;

  select coalesce(jsonb_agg(row_to_json(m)), '[]'::jsonb) into by_method from (
    select payment_method as method, count(*) as orders_count, sum(total) as total
    from public.orders
    where event_id = p_event_id and status <> 'cancelled' and payment_status = 'paid' and not is_courtesy
    group by payment_method
    order by total desc
  ) m;

  select coalesce(jsonb_agg(row_to_json(cr)), '[]'::jsonb) into courtesies from (
    select o.courtesy_reason as reason, count(distinct o.id) as orders_count, sum(oi.subtotal) as value
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.event_id = p_event_id and o.status <> 'cancelled' and o.is_courtesy
    group by o.courtesy_reason
    order by value desc
  ) cr;

  select coalesce(jsonb_agg(row_to_json(cp)), '[]'::jsonb) into credit_by_product from (
    select csi.product_name_snapshot as product_name, sum(csi.quantity) as quantity,
           sum(csi.quantity * csi.unit_price_snapshot) as amount
    from public.credit_spends cs
    join public.credit_spend_items csi on csi.spend_id = cs.id
    where cs.event_id = p_event_id and cs.undone_at is null
    group by csi.product_name_snapshot
    order by amount desc
  ) cp;

  select coalesce(jsonb_agg(row_to_json(cst)), '[]'::jsonb) into credit_by_station from (
    select coalesce(st.name, '(sem ponto)') as station_name, count(*) as spends_count, sum(cs.total) as amount
    from public.credit_spends cs
    left join public.stations st on st.id = cs.station_id
    where cs.event_id = p_event_id and cs.undone_at is null
    group by coalesce(st.name, '(sem ponto)')
    order by amount desc
  ) cst;

  select jsonb_build_object(
    'total_orders', (select count(*) from public.orders where event_id = p_event_id and status <> 'cancelled'),
    'total_tickets', (select count(*) from public.tickets where event_id = p_event_id and status <> 'cancelled'),
    'total_revenue', (select coalesce(sum(total), 0) from public.orders
                       where event_id = p_event_id and status <> 'cancelled' and payment_status = 'paid'),
    'pending_revenue', (select coalesce(sum(total), 0) from public.orders
                         where event_id = p_event_id and status <> 'cancelled' and payment_status = 'pending'),
    'unclaimed_tickets', (select count(*) from public.tickets
                           where event_id = p_event_id and status <> 'cancelled' and customer_id is null),
    'total_items_sold', (select coalesce(sum(ti.quantity_purchased), 0) from public.ticket_items ti
                          join public.tickets tk on tk.id = ti.ticket_id
                          where tk.event_id = p_event_id and tk.status <> 'cancelled'),
    'total_items_delivered', (select coalesce(sum(ti.quantity_redeemed), 0) from public.ticket_items ti
                               join public.tickets tk on tk.id = ti.ticket_id
                               where tk.event_id = p_event_id and tk.status <> 'cancelled'),
    'courtesy_count', (select count(*) from public.orders where event_id = p_event_id and status <> 'cancelled' and is_courtesy),
    'courtesy_value', (select coalesce(sum(oi.subtotal), 0) from public.orders o
                        join public.order_items oi on oi.order_id = o.id
                        where o.event_id = p_event_id and o.status <> 'cancelled' and o.is_courtesy),
    'credit_sold', (select coalesce(sum(oi.subtotal), 0) from public.orders o
                     join public.order_items oi on oi.order_id = o.id
                     join public.products p on p.id = oi.product_id
                     where o.event_id = p_event_id and o.status <> 'cancelled' and o.payment_status = 'paid'
                       and p.kind = 'credit'),
    'credit_spent', (select coalesce(sum(total), 0) from public.credit_spends
                      where event_id = p_event_id and undone_at is null),
    'credit_outstanding', (select coalesce(sum(credit_balance), 0) from public.tickets
                            where event_id = p_event_id and status <> 'cancelled')
  ) into totals;

  return jsonb_build_object('totals', totals, 'by_product', by_product, 'by_cashier', by_cashier,
                            'by_validator', by_validator, 'by_station', by_station, 'by_method', by_method,
                            'courtesies', courtesies, 'credit_by_product', credit_by_product,
                            'credit_by_station', credit_by_station);
end;
$$;
