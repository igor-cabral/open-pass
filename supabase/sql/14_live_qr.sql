-- =========================================================================
-- OpenPass — QR AO VIVO (anti-print)
-- [14] Execute depois de 13_live_panel.sql. Idempotente. Já faz os próprios GRANTs.
--
-- O QR do cliente deixa de ser um código fixo: passa a ser assinado (HMAC) e a
-- mudar a cada 15 segundos. Um print/foto só vale por alguns segundos.
--  * ticket_secrets: segredo de cada ingresso. Ninguém lê direto (sem acesso pela API).
--  * get_my_tickets: devolve o segredo (só no dia do evento) em vez do código fixo.
--  * resolve_live_qr: o validador manda o texto lido; o servidor confere a assinatura
--    e o prazo e devolve o ingresso.
-- =========================================================================

create table if not exists public.ticket_secrets (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  secret text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
alter table public.ticket_secrets enable row level security;  -- sem políticas: só funções do servidor
revoke all on public.ticket_secrets from public, anon, authenticated;
grant all on public.ticket_secrets to service_role;

insert into public.ticket_secrets (ticket_id)
select id from public.tickets
on conflict (ticket_id) do nothing;

create or replace function public.create_ticket_secret()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.ticket_secrets (ticket_id) values (new.id) on conflict (ticket_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_ticket_secret() from public, anon, authenticated;

drop trigger if exists trg_ticket_secret on public.tickets;
create trigger trg_ticket_secret
after insert on public.tickets
for each row execute function public.create_ticket_secret();

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
      -- O código estático do ingresso NUNCA sai do servidor. O cliente recebe só o segredo
      -- que gera o QR ao vivo (muda a cada 15 s) e a hora do servidor para acertar o relógio.
      'qr_secret', case
        when x.status = 'active' and x.blocked_reason is null and not x.locked and not x.ended then x.raw_secret
        else null end,
      'server_now', extract(epoch from now()),
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
      tk.id, tk.status, (select s.secret from public.ticket_secrets s where s.ticket_id = tk.id) as raw_secret, tk.created_at, tk.credit_balance,
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

-- Valida o QR ao vivo lido pelo validador e devolve o código do ingresso.
-- Formato: OP1.<id do ingresso, 32 hex>.<janela de 15 s>.<assinatura, 16 hex>
create or replace function public.resolve_live_qr(p_scan text, p_event_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  actor public.profiles;
  scan text := upper(trim(coalesce(p_scan, '')));
  hex text;
  win bigint;
  win_now bigint := floor(extract(epoch from now()) / 15)::bigint;
  tid uuid;
  tk_code text;
  tk_event uuid;
  sec text;
  expected text;
begin
  actor := public.require_role(array['validator', 'admin']::user_role[]);

  if scan !~ '^OP1\.[0-9A-F]{32}\.[0-9]{1,12}\.[0-9A-F]{16}$' then
    raise exception 'QR inválido. Peça ao cliente para abrir o ingresso no OpenPass.';
  end if;

  hex := split_part(scan, '.', 2);
  win := split_part(scan, '.', 3)::bigint;
  tid := (substr(hex, 1, 8) || '-' || substr(hex, 9, 4) || '-' || substr(hex, 13, 4) || '-' ||
          substr(hex, 17, 4) || '-' || substr(hex, 21, 12))::uuid;

  select tk.public_code, tk.event_id, s.secret
    into tk_code, tk_event, sec
  from public.tickets tk
  join public.ticket_secrets s on s.ticket_id = tk.id
  where tk.id = tid;

  if tk_code is null then
    raise exception 'Ingresso não encontrado.';
  end if;

  expected := upper(substr(encode(extensions.hmac(hex || '.' || win::text, sec, 'sha256'), 'hex'), 1, 16));
  if expected <> split_part(scan, '.', 4) then
    raise exception 'QR inválido. Peça ao cliente para abrir o ingresso no OpenPass.';
  end if;

  -- aceita até 45 s atrás e 15 s à frente (relógio do celular do cliente)
  if win < win_now - 2 or win > win_now + 1 then
    raise exception 'QR vencido. Print e foto não valem: peça ao cliente para mostrar o ingresso ao vivo.';
  end if;

  if tk_event <> p_event_id then
    raise exception 'Este ingresso é de outro evento.';
  end if;

  return tk_code;
end;
$$;

revoke all on function public.resolve_live_qr(text, uuid) from public, anon;
grant execute on function public.resolve_live_qr(text, uuid) to authenticated, service_role;

grant execute on function public.get_my_tickets() to authenticated, service_role;
