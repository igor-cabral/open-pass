-- =========================================================================
-- OpenPass — PAINEL AO VIVO (telão da coordenação)
-- [13] Execute depois de 12_seed_admin.sql. Idempotente. Já faz os próprios GRANTs.
--
-- live_dashboard(evento): números do evento em tempo real — só administrador
-- (com PIN confirmado). Não altera nada, só lê.
-- =========================================================================

create or replace function public.live_dashboard(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  totals jsonb;
  by_product jsonb;
  by_station jsonb;
  recent_sales jsonb;
  recent_deliveries jsonb;
  by_hour jsonb;
begin
  perform public.require_role(array['admin']::user_role[]);

  select jsonb_build_object(
    'orders', (select count(*) from public.orders where event_id = p_event_id and status <> 'cancelled'),
    'revenue', (select coalesce(sum(total), 0) from public.orders
                 where event_id = p_event_id and status <> 'cancelled' and payment_status = 'paid' and not is_courtesy),
    'pending', (select coalesce(sum(total), 0) from public.orders
                 where event_id = p_event_id and status <> 'cancelled' and payment_status = 'pending'),
    'courtesies', (select count(*) from public.orders
                    where event_id = p_event_id and status <> 'cancelled' and is_courtesy),
    'tickets', (select count(*) from public.tickets where event_id = p_event_id and status <> 'cancelled'),
    'items_sold', (select coalesce(sum(ti.quantity_purchased), 0) from public.ticket_items ti
                    join public.tickets tk on tk.id = ti.ticket_id
                    where tk.event_id = p_event_id and tk.status <> 'cancelled'),
    'items_delivered', (select coalesce(sum(ti.quantity_redeemed), 0) from public.ticket_items ti
                         join public.tickets tk on tk.id = ti.ticket_id
                         where tk.event_id = p_event_id and tk.status <> 'cancelled'),
    'credit_sold', (select coalesce(sum(oi.subtotal), 0) from public.orders o
                     join public.order_items oi on oi.order_id = o.id
                     join public.products p on p.id = oi.product_id
                     where o.event_id = p_event_id and o.status <> 'cancelled' and o.payment_status = 'paid'
                       and not o.is_courtesy and p.kind = 'credit'),
    'credit_spent', (select coalesce(sum(total), 0) from public.credit_spends
                      where event_id = p_event_id and undone_at is null),
    'credit_outstanding', (select coalesce(sum(credit_balance), 0) from public.tickets
                            where event_id = p_event_id and status <> 'cancelled'),
    'server_time', now()
  ) into totals;

  select coalesce(jsonb_agg(row_to_json(x) order by x.sold desc), '[]'::jsonb) into by_product from (
    select p.name as product_name, p.stock_limit,
           coalesce(sum(ti.quantity_purchased), 0)::int as sold,
           coalesce(sum(ti.quantity_redeemed), 0)::int as delivered
    from public.products p
    left join public.ticket_items ti on ti.product_id = p.id
      and exists (select 1 from public.tickets tk where tk.id = ti.ticket_id and tk.status <> 'cancelled')
    where p.event_id = p_event_id and p.kind = 'item'
    group by p.id, p.name, p.stock_limit
  ) x;

  select coalesce(jsonb_agg(row_to_json(s) order by s.items desc), '[]'::jsonb) into by_station from (
    select station_name, sum(items)::int as items
    from (
      select coalesce(st.name, '(sem ponto)') as station_name, sum(ri.quantity) as items
      from public.redemptions r
      join public.redemption_items ri on ri.redemption_id = r.id
      left join public.stations st on st.id = r.station_id
      where r.event_id = p_event_id and r.undone_at is null
      group by coalesce(st.name, '(sem ponto)')
      union all
      select coalesce(st.name, '(sem ponto)'), sum(csi.quantity)
      from public.credit_spends cs
      join public.credit_spend_items csi on csi.spend_id = cs.id
      left join public.stations st on st.id = cs.station_id
      where cs.event_id = p_event_id and cs.undone_at is null
      group by coalesce(st.name, '(sem ponto)')
    ) u
    group by station_name
  ) s;

  select coalesce(jsonb_agg(row_to_json(rs)), '[]'::jsonb) into recent_sales from (
    select o.created_at as at, o.order_number, coalesce(o.buyer_name, '') as buyer_name, o.total,
           o.payment_method, o.payment_status, o.is_courtesy, pr.full_name as cashier_name
    from public.orders o
    join public.profiles pr on pr.id = o.cashier_id
    where o.event_id = p_event_id and o.status <> 'cancelled'
    order by o.created_at desc
    limit 8
  ) rs;

  select coalesce(jsonb_agg(row_to_json(rd)), '[]'::jsonb) into recent_deliveries from (
    select * from (
      select r.created_at as at, coalesce(st.name, '—') as station_name, pr.full_name as validator_name,
             (select string_agg(ri.quantity || '× ' || ri.product_name_snapshot, ', ')
                from public.redemption_items ri where ri.redemption_id = r.id) as summary,
             'item'::text as kind
      from public.redemptions r
      join public.profiles pr on pr.id = r.validator_id
      left join public.stations st on st.id = r.station_id
      where r.event_id = p_event_id and r.undone_at is null
      union all
      select cs.created_at, coalesce(st.name, '—'), pr.full_name,
             (select string_agg(csi.quantity || '× ' || csi.product_name_snapshot, ', ')
                from public.credit_spend_items csi where csi.spend_id = cs.id),
             'credit'::text
      from public.credit_spends cs
      join public.profiles pr on pr.id = cs.validator_id
      left join public.stations st on st.id = cs.station_id
      where cs.event_id = p_event_id and cs.undone_at is null
    ) u
    order by at desc
    limit 8
  ) rd;

  select coalesce(jsonb_agg(row_to_json(h) order by h.hour), '[]'::jsonb) into by_hour from (
    select to_char(date_trunc('hour', o.created_at at time zone 'America/Sao_Paulo'), 'HH24') || 'h' as hour,
           count(*)::int as orders, coalesce(sum(o.total), 0) as amount
    from public.orders o
    where o.event_id = p_event_id and o.status <> 'cancelled' and o.created_at > now() - interval '12 hours'
    group by date_trunc('hour', o.created_at at time zone 'America/Sao_Paulo')
  ) h;

  return jsonb_build_object('totals', totals, 'by_product', by_product, 'by_station', by_station,
                            'recent_sales', recent_sales, 'recent_deliveries', recent_deliveries, 'by_hour', by_hour);
end;
$$;

revoke all on function public.live_dashboard(uuid) from public, anon;
grant execute on function public.live_dashboard(uuid) to authenticated, service_role;
