-- =========================================================================
-- OpenPass v2 — SCHEMA
--   * resgate do ingresso por link/QR (cliente cria a conta DEPOIS da compra)
--   * pontos de entrega (estações) por evento
--   * idempotência / desfazer entrega
--   * tentativas de login por IP, PIN de admin validado no servidor
--   * colunas e bucket que o app já usava mas nunca existiram nos scripts
--
-- [8/12] Execute depois de 07_stock_and_order_edit.sql. É idempotente (pode rodar
-- de novo sem estragar nada). Depois rode 09_v2_functions.sql,
-- 10_v2_extras.sql e 11_v2_hardening.sql, nesta ordem.
-- =========================================================================

-- -------------------------------------------------------------------------
-- 0) Fuso horário. O Postgres do Supabase roda em UTC: current_date vira
-- "amanhã" às 21h no Brasil. Todas as regras de "dia do evento" passam a
-- usar estas funções.
-- -------------------------------------------------------------------------
create or replace function public.today_br()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$;

-- O "dia operacional" do evento vai da meia-noite do dia do evento até as
-- 6h da manhã seguinte (festa que passa da meia-noite continua valendo).
create or replace function public.event_is_operational(p_event_date date)
returns boolean
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo') >= p_event_date::timestamp
     and (now() at time zone 'America/Sao_Paulo') < (p_event_date + 1)::timestamp + interval '6 hours';
$$;

-- -------------------------------------------------------------------------
-- 1) Colunas que o front-end já usava e que não existiam nos scripts 01–08
-- -------------------------------------------------------------------------
alter table public.events
  add column if not exists primary_color text,
  add column if not exists logo_url text;

do $$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('event-logos', 'event-logos', true)
    on conflict (id) do nothing;

    execute 'drop policy if exists "event_logos_admin_write" on storage.objects';
    execute $p$create policy "event_logos_admin_write" on storage.objects
      for all to authenticated
      using (bucket_id = 'event-logos' and public.is_admin())
      with check (bucket_id = 'event-logos' and public.is_admin())$p$;
  end if;
end $$;

-- -------------------------------------------------------------------------
-- 2) Cliente passa a existir DEPOIS da compra: pedido/ticket sem dono até o
-- resgate. O link de resgate guarda só o HASH do token (o token em si só
-- aparece uma vez, para o caixa, na tela da venda).
-- -------------------------------------------------------------------------
alter table public.customers add column if not exists email text;
create unique index if not exists uq_customers_email
  on public.customers (lower(email)) where email is not null;

alter table public.orders alter column customer_id drop not null;
alter table public.orders add column if not exists buyer_name text;

alter table public.tickets alter column customer_id drop not null;
alter table public.tickets add column if not exists claim_token_hash text;
alter table public.tickets add column if not exists claimed_at timestamptz;
create unique index if not exists uq_tickets_claim_hash
  on public.tickets (claim_token_hash) where claim_token_hash is not null;

-- tickets antigos já pertencem a alguém: consideram-se resgatados.
update public.tickets set claimed_at = created_at where customer_id is not null and claimed_at is null;

-- -------------------------------------------------------------------------
-- 3) Pontos de entrega
-- -------------------------------------------------------------------------
create table if not exists public.stations (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);
create index if not exists idx_stations_event on public.stations (event_id);

create table if not exists public.station_products (
  station_id uuid not null references public.stations (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  primary key (station_id, product_id)
);
create index if not exists idx_station_products_product on public.station_products (product_id);

alter table public.event_staff
  add column if not exists station_id uuid references public.stations (id) on delete set null;

-- o ponto do validador precisa ser do mesmo evento da atribuição
create or replace function public.trg_event_staff_station_check()
returns trigger
language plpgsql
as $$
begin
  if new.station_id is not null
     and not exists (select 1 from public.stations s where s.id = new.station_id and s.event_id = new.event_id) then
    raise exception 'O ponto de entrega não pertence a este evento.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_event_staff_station_check on public.event_staff;
create trigger trg_event_staff_station_check
  before insert or update on public.event_staff
  for each row execute function public.trg_event_staff_station_check();

-- o produto do ponto precisa ser do mesmo evento do ponto
create or replace function public.trg_station_products_check()
returns trigger
language plpgsql
as $$
begin
  if not exists (
    select 1 from public.stations s join public.products p on p.event_id = s.event_id
    where s.id = new.station_id and p.id = new.product_id
  ) then
    raise exception 'O produto não pertence ao evento deste ponto de entrega.';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_station_products_check on public.station_products;
create trigger trg_station_products_check
  before insert or update on public.station_products
  for each row execute function public.trg_station_products_check();

alter table public.stations enable row level security;
alter table public.station_products enable row level security;

drop policy if exists "stations_admin_all" on public.stations;
create policy "stations_admin_all" on public.stations
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "stations_select_staff" on public.stations;
create policy "stations_select_staff" on public.stations
  for select using (public.my_role() in ('cashier', 'validator'));

drop policy if exists "station_products_admin_all" on public.station_products;
create policy "station_products_admin_all" on public.station_products
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists "station_products_select_staff" on public.station_products;
create policy "station_products_select_staff" on public.station_products
  for select using (public.my_role() in ('cashier', 'validator'));

grant select, insert, update, delete on public.stations to authenticated;
grant select, insert, update, delete on public.station_products to authenticated;

-- -------------------------------------------------------------------------
-- 4) Entregas: idempotência (mesmo toque/retry não duplica a baixa),
-- ponto onde foi entregue e "desfazer".
-- -------------------------------------------------------------------------
alter table public.redemptions
  add column if not exists request_id uuid,
  add column if not exists station_id uuid references public.stations (id) on delete set null,
  add column if not exists undone_at timestamptz,
  add column if not exists undone_by uuid references public.profiles (id);

create unique index if not exists uq_redemptions_request
  on public.redemptions (validator_id, request_id) where request_id is not null;

-- -------------------------------------------------------------------------
-- 5) Tentativas de login (por conta + IP). Só a service_role mexe aqui.
-- -------------------------------------------------------------------------
create table if not exists public.login_attempts (
  id bigint generated always as identity primary key,
  scope text not null,          -- 'customer' | 'staff' | 'claim'
  identifier text not null,     -- telefone/e-mail normalizado ou username
  ip text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_login_attempts_lookup on public.login_attempts (scope, identifier, created_at);
create index if not exists idx_login_attempts_ip on public.login_attempts (scope, identifier, ip, created_at);
alter table public.login_attempts enable row level security;
revoke all on public.login_attempts from anon, authenticated;

-- -------------------------------------------------------------------------
-- 6) PIN do administrador validado no SERVIDOR.
--   * Sem PIN configurado (app_settings.admin_pin_hash ausente): nada muda.
--   * Com PIN: o admin só enxerga/gera dados administrativos depois de
--     confirmar o PIN (sessão de 8h). Ver 09_v2_functions.sql.
-- -------------------------------------------------------------------------
create table if not exists public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;

create table if not exists public.admin_pin_sessions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  verified_until timestamptz not null
);
alter table public.admin_pin_sessions enable row level security;
revoke all on public.admin_pin_sessions from anon, authenticated;

create table if not exists public.admin_pin_failures (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  failed int not null default 0,
  locked_until timestamptz
);
alter table public.admin_pin_failures enable row level security;
revoke all on public.admin_pin_failures from anon, authenticated;
