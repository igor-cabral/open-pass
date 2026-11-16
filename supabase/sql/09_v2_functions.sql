-- =========================================================================
-- OpenPass v2 — FUNÇÕES (RPC)
-- [9/12] Execute depois de 08_v2_schema.sql. Idempotente.
--
-- Regras centrais desta versão:
--   * Uma única regra de "pode entregar?" (ticket_block_reason): ticket e
--     pedido ativos, pagamento confirmado, evento publicado/encerrado.
--   * "Dia do evento" no fuso de São Paulo (today_br / event_is_operational).
--   * Venda NÃO cria cliente: gera um ticket com link de resgate. O cliente
--     cria a conta depois (Edge Function claim-ticket → claim_ticket()).
--   * Entrega só no ponto certo (station_products) e idempotente.
-- =========================================================================

-- -------------------------------------------------------------------------
-- PIN do administrador (validado no servidor)
-- -------------------------------------------------------------------------
create or replace function public.admin_pin_ok(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.app_settings where key = 'admin_pin_hash')
      or exists (
        select 1 from public.admin_pin_sessions s
        where s.user_id = p_user_id and s.verified_until > now()
      );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and active)
     and public.admin_pin_ok(auth.uid());
$$;

create or replace function public.require_role(p_roles user_role[])
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles;
begin
  select * into prof from public.profiles where id = auth.uid();
  if prof.id is null then
    raise exception 'Não autenticado.' using errcode = '28000';
  end if;
  if not prof.active then
    raise exception 'Usuário bloqueado.' using errcode = '28000';
  end if;
  if not (prof.role = any(p_roles)) then
    raise exception 'Você não possui permissão para realizar esta operação.' using errcode = '42501';
  end if;
  if prof.role = 'admin' and not public.admin_pin_ok(prof.id) then
    raise exception 'Confirme o código de segunda etapa do administrador.' using errcode = '28000';
  end if;
  return prof;
end;
$$;

-- 'not_required' | 'ok' | 'needed'
create or replace function public.admin_pin_status()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prof public.profiles;
begin
  select * into prof from public.profiles where id = auth.uid();
  if prof.id is null or prof.role <> 'admin' or not prof.active then
    return 'not_required';
  end if;
  if not exists (select 1 from public.app_settings where key = 'admin_pin_hash') then
    return 'not_required';
  end if;
  if exists (select 1 from public.admin_pin_sessions where user_id = prof.id and verified_until > now()) then
    return 'ok';
  end if;
  return 'needed';
end;
$$;

-- Definir/trocar o PIN: rode no SQL Editor do Supabase (não é exposta ao app):
--   select public.set_admin_pin('123456');
-- Para remover o PIN:  select public.set_admin_pin(null);
create or replace function public.set_admin_pin(p_pin text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_pin is null then
    delete from public.app_settings where key = 'admin_pin_hash';
    delete from public.admin_pin_sessions;
    return;
  end if;
  if p_pin !~ '^[0-9]{6,12}$' then
    raise exception 'O PIN deve ter de 6 a 12 dígitos numéricos.';
  end if;
  insert into public.app_settings (key, value)
  values ('admin_pin_hash', extensions.crypt(p_pin, extensions.gen_salt('bf')))
  on conflict (key) do update set value = excluded.value, updated_at = now();
  delete from public.admin_pin_sessions;
end;
$$;

drop function if exists public.verify_admin_pin(text);
create function public.verify_admin_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  prof public.profiles;
  h text;
  f public.admin_pin_failures;
  new_failed int;
begin
  select * into prof from public.profiles where id = auth.uid();
  if prof.id is null or prof.role <> 'admin' or not prof.active then
    raise exception 'Não autorizado.' using errcode = '42501';
  end if;

  select value into h from public.app_settings where key = 'admin_pin_hash';
  if h is null then
    return true; -- PIN não configurado: não há segunda etapa
  end if;

  select * into f from public.admin_pin_failures where user_id = prof.id for update;
  if f.user_id is not null and f.locked_until is not null then
    if f.locked_until > now() then
      raise exception 'Muitas tentativas. Tente de novo em % minuto(s).',
        ceil(extract(epoch from (f.locked_until - now())) / 60);
    end if;
    delete from public.admin_pin_failures where user_id = prof.id;
    f.user_id := null;
  end if;

  if extensions.crypt(coalesce(p_pin, ''), h) = h then
    delete from public.admin_pin_failures where user_id = prof.id;
    insert into public.admin_pin_sessions (user_id, verified_until)
    values (prof.id, now() + interval '8 hours')
    on conflict (user_id) do update set verified_until = excluded.verified_until;
    return true;
  end if;

  new_failed := coalesce(f.failed, 0) + 1;
  insert into public.admin_pin_failures (user_id, failed, locked_until)
  values (prof.id, new_failed, case when new_failed >= 5 then now() + interval '15 minutes' end)
  on conflict (user_id) do update
    set failed = excluded.failed, locked_until = excluded.locked_until;
  return false;
end;
$$;

-- -------------------------------------------------------------------------
-- Helpers do ticket
-- -------------------------------------------------------------------------
create or replace function public.generate_claim_token()
returns text
language plpgsql
as $$
begin
  -- 24 bytes aleatórios = 192 bits, em base64url (32 caracteres)
  return translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/=', '-_');
end;
$$;

create or replace function public.claim_token_hash(p_token text)
returns text
language sql
immutable
as $$
  select encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

-- Única regra de "este ticket pode ser entregue?". null = pode.
create or replace function public.ticket_block_reason(p_ticket_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when tk.status = 'cancelled' or o.status = 'cancelled' then 'Ticket cancelado.'
    when o.payment_status = 'pending' then 'Pagamento pendente. Confirme com o caixa antes de entregar.'
    when o.payment_status = 'cancelled' then 'Pagamento cancelado.'
    when ev.status in ('draft', 'cancelled') then 'Evento indisponível.'
    else null
  end
  from public.tickets tk
  join public.orders o on o.id = tk.order_id
  join public.events ev on ev.id = tk.event_id
  where tk.id = p_ticket_id;
$$;

-- Escopo do validador num evento (interno).
create or replace function public.validator_scope(p_actor_id uuid, p_actor_role user_role, p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  has_st boolean;
  es public.event_staff;
  st public.stations;
begin
  select exists (select 1 from public.stations where event_id = p_event_id) into has_st;

  if p_actor_role = 'admin' then
    return jsonb_build_object('assigned', true, 'has_stations', has_st, 'restricted', false,
      'station_id', null, 'station_name', null, 'station_active', true);
  end if;

  select * into es from public.event_staff where event_id = p_event_id and profile_id = p_actor_id;
  if es.profile_id is null then
    return jsonb_build_object('assigned', false, 'has_stations', has_st, 'restricted', false,
      'station_id', null, 'station_name', null, 'station_active', true);
  end if;

  if es.station_id is not null then
    select * into st from public.stations where id = es.station_id;
  end if;

  return jsonb_build_object('assigned', true, 'has_stations', has_st, 'restricted', has_st,
    'station_id', es.station_id, 'station_name', st.name, 'station_active', coalesce(st.active, true));
end;
$$;

-- Ponto de entrega do validador logado, para a tela mostrar "Seu ponto: Bar".
create or replace function public.get_my_station(p_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  sc jsonb;
begin
  actor := public.require_role(array['validator', 'admin']::user_role[]);
  sc := public.validator_scope(actor.id, actor.role, p_event_id);
  return jsonb_build_object(
    'assigned', (sc->>'assigned')::boolean,
    'event_has_stations', (sc->>'has_stations')::boolean,
    'station_id', sc->'station_id',
    'station_name', sc->'station_name',
    'needs_station', (sc->>'restricted')::boolean and (sc->>'station_id') is null
  );
end;
$$;

-- -------------------------------------------------------------------------
-- VENDA (caixa): só vende. Gera ticket + link de resgate. O token aparece
-- UMA vez na resposta; no banco fica só o hash.
-- -------------------------------------------------------------------------
drop function if exists public.create_sale(uuid, uuid, jsonb, order_payment_method, order_payment_status);

create or replace function public.create_sale(
  p_event_id uuid,
  p_items jsonb,                -- [{ "product_id": "uuid", "quantity": 2 }, ...]
  p_payment_method order_payment_method default 'cash',
  p_payment_status order_payment_status default 'paid',
  p_buyer_name text default null
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
  new_order_id uuid;
  new_ticket_id uuid;
  new_code text;
  code_exists boolean;
  already_sold int;
  claim_token text;
begin
  actor := public.require_role(array['cashier', 'admin']::user_role[]);

  if p_payment_status not in ('paid', 'pending') then
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
  if exists (
    select 1 from jsonb_array_elements(p_items) e
    where (e->>'product_id') is null or coalesce((e->>'quantity')::int, 0) <= 0
  ) then
    raise exception 'Quantidade inválida para um dos produtos.';
  end if;

  new_order_id := gen_random_uuid();
  insert into public.orders (id, event_id, customer_id, cashier_id, payment_method, payment_status, total, buyer_name)
  values (new_order_id, p_event_id, null, actor.id, p_payment_method, p_payment_status, 0,
          nullif(left(trim(coalesce(p_buyer_name, '')), 80), ''));

  loop
    new_code := public.generate_ticket_code();
    select exists (select 1 from public.tickets where public_code = new_code) into code_exists;
    exit when not code_exists;
  end loop;

  claim_token := public.generate_claim_token();
  new_ticket_id := gen_random_uuid();
  insert into public.tickets (id, public_code, order_id, event_id, customer_id, status, claim_token_hash)
  values (new_ticket_id, new_code, new_order_id, p_event_id, null, 'active', public.claim_token_hash(claim_token));

  -- junta linhas repetidas do mesmo produto e trava sempre na mesma ordem
  for line in
    select (e->>'product_id')::uuid as product_id, sum((e->>'quantity')::int)::int as qty
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
  end loop;

  update public.orders set total = running_total where id = new_order_id;

  perform public.log_audit('sale.create', jsonb_build_object(
    'order_id', new_order_id, 'ticket_id', new_ticket_id, 'event_id', p_event_id,
    'total', running_total, 'payment_status', p_payment_status
  ));

  return jsonb_build_object(
    'order_id', new_order_id,
    'ticket_id', new_ticket_id,
    'ticket_code', new_code,
    'total', running_total,
    'payment_status', p_payment_status,
    'claim_token', claim_token
  );
end;
$$;

-- Novo link de resgate (cliente perdeu o link). Invalida o anterior.
create or replace function public.regenerate_claim_link(p_ticket_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  tk public.tickets;
  ord public.orders;
  claim_token text;
begin
  actor := public.require_role(array['cashier', 'admin']::user_role[]);

  select * into tk from public.tickets where id = p_ticket_id for update;
  if tk.id is null then
    raise exception 'Ticket não encontrado.';
  end if;
  select * into ord from public.orders where id = tk.order_id;
  if actor.role = 'cashier' and ord.cashier_id <> actor.id then
    raise exception 'Você só pode gerar link das suas próprias vendas.';
  end if;
  if tk.customer_id is not null then
    raise exception 'Este ingresso já foi resgatado por uma conta.';
  end if;
  if tk.status = 'cancelled' or ord.status = 'cancelled' then
    raise exception 'Este ingresso está cancelado.';
  end if;

  claim_token := public.generate_claim_token();
  update public.tickets set claim_token_hash = public.claim_token_hash(claim_token) where id = tk.id;

  perform public.log_audit('ticket.claim_link_regenerated', jsonb_build_object('ticket_id', tk.id));
  return jsonb_build_object('claim_token', claim_token);
end;
$$;

-- Confirmar pagamento pendente (caixa dono da venda ou admin)
create or replace function public.confirm_payment(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  ord public.orders;
begin
  actor := public.require_role(array['cashier', 'admin']::user_role[]);

  select * into ord from public.orders where id = p_order_id for update;
  if ord.id is null then
    raise exception 'Pedido não encontrado.';
  end if;
  if actor.role = 'cashier' and ord.cashier_id <> actor.id then
    raise exception 'Você só pode confirmar pagamento das suas próprias vendas.';
  end if;
  if ord.status = 'cancelled' then
    raise exception 'Este pedido está cancelado.';
  end if;
  if ord.payment_status <> 'pending' then
    raise exception 'Este pedido não está com pagamento pendente.';
  end if;

  update public.orders set payment_status = 'paid' where id = ord.id;
  perform public.log_audit('order.payment_confirm', jsonb_build_object('order_id', ord.id, 'total', ord.total));
  return jsonb_build_object('ok', true);
end;
$$;

-- Vendas recentes do caixa (admin vê todas) — para reenviar link e confirmar pagamento
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
      o.status as order_status,
      o.buyer_name,
      (tk.customer_id is not null) as claimed,
      pr.full_name as customer_name,
      (
        select coalesce(jsonb_agg(jsonb_build_object('name', oi.product_name_snapshot, 'quantity', oi.quantity)
                                  order by oi.created_at), '[]'::jsonb)
        from public.order_items oi where oi.order_id = o.id
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
-- RESGATE DO INGRESSO (chamadas só pela Edge Function claim-ticket, com
-- service_role). Recebem o HASH do token, nunca o token.
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
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object('name', ti.product_name_snapshot, 'quantity', ti.quantity_purchased)
                                order by ti.created_at), '[]'::jsonb)
      from public.ticket_items ti where ti.ticket_id = tk.id
    )
  );
end;
$$;

create or replace function public.claim_ticket(p_token_hash text, p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tk public.tickets;
begin
  select * into tk from public.tickets
    where claim_token_hash = p_token_hash and customer_id is null
    for update;
  if tk.id is null then
    raise exception 'Link inválido ou já utilizado.';
  end if;
  if tk.status = 'cancelled' then
    raise exception 'Este ingresso foi cancelado.';
  end if;
  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Cliente não encontrado.';
  end if;

  update public.tickets
    set customer_id = p_customer_id, claimed_at = now(), claim_token_hash = null
    where id = tk.id;
  update public.orders set customer_id = p_customer_id where id = tk.order_id;

  insert into public.audit_logs (actor_id, actor_role, action, details)
  values (p_customer_id, 'customer', 'ticket.claim', jsonb_build_object('ticket_id', tk.id, 'event_id', tk.event_id));

  return jsonb_build_object('ticket_id', tk.id, 'event_id', tk.event_id);
end;
$$;

-- -------------------------------------------------------------------------
-- CLIENTE: meus tickets (código só no dia do evento, pagamento confirmado)
-- -------------------------------------------------------------------------
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
      'items', x.items
    ) order by x.event_date desc, x.created_at desc
  ), '[]'::jsonb) into result
  from (
    select
      tk.id, tk.status, tk.public_code as raw_code, tk.created_at,
      ev.id as event_id, ev.name as event_name, ev.event_date, ev.event_time, ev.location,
      ev.status as event_status, ev.primary_color, ev.logo_url,
      public.ticket_block_reason(tk.id) as blocked_reason,
      (public.today_br() < ev.event_date) as locked,
      (public.today_br() >= ev.event_date and not public.event_is_operational(ev.event_date)) as ended,
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

-- -------------------------------------------------------------------------
-- VALIDADOR: consultar (sem consumir) e entregar
-- -------------------------------------------------------------------------
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

  return jsonb_build_object(
    'ticket_id', tk.id,
    'public_code', tk.public_code,
    'status', tk.status,
    'event_name', ev.name,
    'holder_name', holder,
    'blocked_reason', public.ticket_block_reason(tk.id),
    'station_name', sc->>'station_name',
    'items', items
  );
end;
$$;

drop function if exists public.redeem_ticket_items(text, uuid, jsonb);

create or replace function public.redeem_ticket_items(
  p_public_code text,
  p_event_id uuid,
  p_items jsonb,                -- [{ "ticket_item_id": "uuid", "quantity": 1 }, ...]
  p_request_id uuid default null -- idempotência: o mesmo id nunca dá baixa duas vezes
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
  prev public.redemptions;
  item jsonb;
  ti public.ticket_items;
  qty int;
  new_redemption_id uuid;
  total_remaining int;
  reason text;
  result_items jsonb := '[]'::jsonb;
begin
  actor := public.require_role(array['validator', 'admin']::user_role[]);

  -- repetição do mesmo pedido (toque duplo, retry de rede): devolve o resultado anterior
  if p_request_id is not null then
    select * into prev from public.redemptions where validator_id = actor.id and request_id = p_request_id;
    if prev.id is not null then
      return jsonb_build_object(
        'redemption_id', prev.id,
        'ticket_status', (select status from public.tickets where id = prev.ticket_id),
        'duplicate', true,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object('product_name', ri.product_name_snapshot, 'delivered_now', ri.quantity)), '[]'::jsonb)
          from public.redemption_items ri where ri.redemption_id = prev.id
        )
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
    raise exception 'Nenhum item selecionado para entrega.';
  end if;

  new_redemption_id := gen_random_uuid();
  insert into public.redemptions (id, ticket_id, event_id, validator_id, request_id, station_id)
  values (new_redemption_id, tk.id, p_event_id, actor.id, p_request_id, v_station_id);

  for item in select * from jsonb_array_elements(p_items)
  loop
    qty := (item->>'quantity')::int;
    if qty is null or qty <= 0 then
      raise exception 'Quantidade inválida.';
    end if;

    select * into ti from public.ticket_items
      where id = (item->>'ticket_item_id')::uuid and ticket_id = tk.id
      for update;
    if ti.id is null then
      raise exception 'Item do ticket não encontrado.';
    end if;

    if restricted and not exists (
      select 1 from public.station_products sp where sp.station_id = v_station_id and sp.product_id = ti.product_id
    ) then
      raise exception '"%" não é entregue neste ponto de entrega.', ti.product_name_snapshot;
    end if;

    if (ti.quantity_purchased - ti.quantity_redeemed) <= 0 then
      raise exception 'Não há itens disponíveis para "%".', ti.product_name_snapshot;
    end if;
    if qty > (ti.quantity_purchased - ti.quantity_redeemed) then
      raise exception 'Quantidade solicitada maior que a disponível para "%".', ti.product_name_snapshot;
    end if;

    update public.ticket_items set quantity_redeemed = quantity_redeemed + qty where id = ti.id;

    insert into public.redemption_items (redemption_id, ticket_item_id, product_name_snapshot, quantity)
    values (new_redemption_id, ti.id, ti.product_name_snapshot, qty);

    result_items := result_items || jsonb_build_object(
      'product_name', ti.product_name_snapshot,
      'delivered_now', qty,
      'available', (ti.quantity_purchased - ti.quantity_redeemed - qty)
    );
  end loop;

  select coalesce(sum(quantity_purchased - quantity_redeemed), 0) into total_remaining
  from public.ticket_items where ticket_id = tk.id;

  if total_remaining = 0 then
    update public.tickets set status = 'fully_redeemed' where id = tk.id;
  end if;

  perform public.log_audit('ticket.redeem', jsonb_build_object(
    'ticket_id', tk.id, 'redemption_id', new_redemption_id, 'station_id', v_station_id, 'items', p_items
  ));

  return jsonb_build_object(
    'redemption_id', new_redemption_id,
    'ticket_status', (select status from public.tickets where id = tk.id),
    'items', result_items
  );
end;
$$;

-- Desfazer uma entrega: validador, só a própria e em até 3 minutos; admin sempre.
create or replace function public.undo_redemption(p_redemption_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  r public.redemptions;
  ri record;
begin
  actor := public.require_role(array['validator', 'admin']::user_role[]);

  select * into r from public.redemptions where id = p_redemption_id for update;
  if r.id is null then
    raise exception 'Entrega não encontrada.';
  end if;
  if r.undone_at is not null then
    raise exception 'Esta entrega já foi desfeita.';
  end if;
  if actor.role = 'validator'
     and (r.validator_id <> actor.id or r.created_at < now() - interval '3 minutes') then
    raise exception 'Só é possível desfazer a sua própria entrega nos primeiros 3 minutos.';
  end if;

  perform 1 from public.tickets where id = r.ticket_id for update;

  for ri in select * from public.redemption_items where redemption_id = r.id
  loop
    update public.ticket_items
      set quantity_redeemed = quantity_redeemed - ri.quantity
      where id = ri.ticket_item_id;
  end loop;

  update public.redemptions set undone_at = now(), undone_by = actor.id where id = r.id;
  update public.tickets set status = 'active' where id = r.ticket_id and status = 'fully_redeemed';

  perform public.log_audit('ticket.redeem_undo', jsonb_build_object('redemption_id', r.id, 'ticket_id', r.ticket_id));
  return jsonb_build_object('ok', true);
end;
$$;

-- -------------------------------------------------------------------------
-- Estoque (agora só para equipe) e relatório
-- -------------------------------------------------------------------------
create or replace function public.list_stock_status(p_event_id uuid)
returns table (product_id uuid, stock_limit int, sold int, remaining int)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as product_id,
    p.stock_limit,
    coalesce(sold.qty, 0)::int as sold,
    case when p.stock_limit is null then null else greatest(p.stock_limit - coalesce(sold.qty, 0), 0)::int end as remaining
  from public.products p
  left join (
    select ti.product_id, sum(ti.quantity_purchased) as qty
    from public.ticket_items ti
    join public.tickets tk on tk.id = ti.ticket_id
    where tk.status <> 'cancelled'
    group by ti.product_id
  ) sold on sold.product_id = p.id
  where p.event_id = p_event_id
    and public.my_role() in ('admin', 'cashier', 'validator');
$$;

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
    where o.event_id = p_event_id and o.status <> 'cancelled' and o.payment_status = 'paid'
    group by pr.full_name
    order by total_amount desc
  ) c;

  select coalesce(jsonb_agg(row_to_json(v)), '[]'::jsonb) into by_validator from (
    select pr.full_name as validator_name, count(distinct r.id) as redemptions_count,
           sum(ri.quantity) as items_delivered
    from public.redemptions r
    join public.profiles pr on pr.id = r.validator_id
    join public.redemption_items ri on ri.redemption_id = r.id
    where r.event_id = p_event_id and r.undone_at is null
    group by pr.full_name
    order by items_delivered desc
  ) v;

  select coalesce(jsonb_agg(row_to_json(s)), '[]'::jsonb) into by_station from (
    select coalesce(st.name, '(sem ponto)') as station_name,
           count(distinct r.id) as redemptions_count,
           sum(ri.quantity) as items_delivered
    from public.redemptions r
    join public.redemption_items ri on ri.redemption_id = r.id
    left join public.stations st on st.id = r.station_id
    where r.event_id = p_event_id and r.undone_at is null
    group by coalesce(st.name, '(sem ponto)')
    order by items_delivered desc
  ) s;

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
                               where tk.event_id = p_event_id and tk.status <> 'cancelled')
  ) into totals;

  return jsonb_build_object('totals', totals, 'by_product', by_product, 'by_cashier', by_cashier,
                            'by_validator', by_validator, 'by_station', by_station);
end;
$$;

-- -------------------------------------------------------------------------
-- Funções que o app chamava e que não existiam nos scripts anteriores
-- -------------------------------------------------------------------------
-- Usada pela Edge Function admin-delete-staff-user (service_role).
create or replace function public.staff_has_history(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.orders where cashier_id = p_user_id or cancelled_by = p_user_id)
      or exists (select 1 from public.redemptions where validator_id = p_user_id or undone_by = p_user_id)
      or exists (select 1 from public.audit_logs where actor_id = p_user_id)
      or exists (select 1 from public.profiles where created_by = p_user_id)
      or exists (select 1 from public.password_reset_requests where resolved_by = p_user_id);
$$;

-- Cliente sem nenhuma compra pode ser removido (apaga também a conta de login).
create or replace function public.admin_delete_customer(p_customer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
begin
  actor := public.require_role(array['admin']::user_role[]);

  if not exists (select 1 from public.customers where id = p_customer_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  if exists (select 1 from public.orders where customer_id = p_customer_id)
     or exists (select 1 from public.tickets where customer_id = p_customer_id) then
    raise exception 'Este cliente possui ingressos/pedidos. Cancele os pedidos em vez de excluir o cliente.';
  end if;

  perform public.log_audit('customer.delete', jsonb_build_object('customer_id', p_customer_id));
  delete from auth.users where id = p_customer_id;  -- apaga profiles/customers em cascata
  return jsonb_build_object('ok', true);
end;
$$;

-- -------------------------------------------------------------------------
-- CORREÇÃO DE BUG ANTIGO (scripts 07/08): nestas duas funções a variável
-- local se chamava "ti", igual ao alias da tabela ticket_items. O Postgres
-- respondia "column reference ti.ticket_id is ambiguous" e editar/remover
-- item de pedido NUNCA funcionava. A lógica é a mesma, só renomeei a variável.
-- -------------------------------------------------------------------------
create or replace function public.admin_edit_order_item(p_order_item_id uuid, p_new_quantity int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  oi public.order_items;
  tit public.ticket_items;
  prod public.products;
  new_total numeric(10,2);
  sold_excluding int;
begin
  actor := public.require_role(array['admin']::user_role[]);

  if p_new_quantity <= 0 then
    raise exception 'A quantidade precisa ser maior que zero (use "remover item" pra tirar do pedido).';
  end if;

  select * into oi from public.order_items where id = p_order_item_id for update;
  if oi.id is null then
    raise exception 'Item do pedido não encontrado.';
  end if;

  select * into prod from public.products where id = oi.product_id for update;

  select ti.* into tit
    from public.ticket_items ti
    join public.tickets tk on tk.id = ti.ticket_id
    where tk.order_id = oi.order_id and ti.product_id = oi.product_id
    for update of ti;

  if tit.id is not null and p_new_quantity < tit.quantity_redeemed then
    raise exception 'Não é possível reduzir para menos do que já foi entregue (%).', tit.quantity_redeemed;
  end if;

  if prod.stock_limit is not null and p_new_quantity > oi.quantity then
    select coalesce(sum(ti2.quantity_purchased), 0) into sold_excluding
    from public.ticket_items ti2
    join public.tickets tk2 on tk2.id = ti2.ticket_id
    where ti2.product_id = prod.id and tk2.status <> 'cancelled' and ti2.id is distinct from tit.id;

    if sold_excluding + p_new_quantity > prod.stock_limit then
      raise exception 'Estoque insuficiente para "%": restam % no total.',
        prod.name, greatest(prod.stock_limit - sold_excluding, 0);
    end if;
  end if;

  update public.order_items
    set quantity = p_new_quantity, subtotal = unit_price_snapshot * p_new_quantity
    where id = oi.id;

  if tit.id is not null then
    update public.ticket_items set quantity_purchased = p_new_quantity where id = tit.id;
  end if;

  select coalesce(sum(subtotal), 0) into new_total from public.order_items where order_id = oi.order_id;
  update public.orders set total = new_total where id = oi.order_id;

  perform public.log_audit('order_item.edit', jsonb_build_object(
    'order_item_id', oi.id, 'order_id', oi.order_id,
    'old_quantity', oi.quantity, 'new_quantity', p_new_quantity
  ));

  return jsonb_build_object('ok', true, 'new_total', new_total);
end;
$$;

create or replace function public.admin_remove_order_item(p_order_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  oi public.order_items;
  tit public.ticket_items;
  item_count int;
  new_total numeric(10,2);
begin
  actor := public.require_role(array['admin']::user_role[]);

  select * into oi from public.order_items where id = p_order_item_id for update;
  if oi.id is null then
    raise exception 'Item do pedido não encontrado.';
  end if;

  select count(*) into item_count from public.order_items where order_id = oi.order_id;
  if item_count <= 1 then
    raise exception 'Este é o único item do pedido — cancele o pedido inteiro em vez de remover o item.';
  end if;

  select ti.* into tit
    from public.ticket_items ti
    join public.tickets tk on tk.id = ti.ticket_id
    where tk.order_id = oi.order_id and ti.product_id = oi.product_id
    for update of ti;

  if tit.id is not null and tit.quantity_redeemed > 0 then
    raise exception 'Não é possível remover: % unidade(s) já foram entregues. Reabra a entrega primeiro.', tit.quantity_redeemed;
  end if;

  if tit.id is not null then
    -- saldo entregue = 0, então o que sobrou em redemption_items são entregas já desfeitas
    delete from public.redemption_items where ticket_item_id = tit.id;
    delete from public.ticket_items where id = tit.id;
  end if;
  delete from public.order_items where id = oi.id;

  select coalesce(sum(subtotal), 0) into new_total from public.order_items where order_id = oi.order_id;
  update public.orders set total = new_total where id = oi.order_id;

  perform public.log_audit('order_item.remove', jsonb_build_object(
    'order_item_id', oi.id, 'order_id', oi.order_id, 'product_id', oi.product_id, 'quantity', oi.quantity
  ));

  return jsonb_build_object('ok', true, 'new_total', new_total);
end;
$$;
