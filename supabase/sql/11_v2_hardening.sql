-- =========================================================================
-- OpenPass v2 — ENDURECIMENTO DE PERMISSÕES
-- [11/12] Execute POR ÚLTIMO entre os scripts de estrutura (depois de 08, 09 e 10).
--
-- Problema antigo: "grant execute on all functions in schema public to
-- authenticated" (repetido em vários scripts) + o EXECUTE que o Postgres dá
-- a PUBLIC por padrão deixavam qualquer função, inclusive internas como
-- log_audit() (que grava a auditoria), chamável por qualquer usuário — até
-- sem login. Aqui tudo é fechado e só o que o app realmente chama é aberto,
-- função por função.
--
-- Sempre que criar uma função nova que o app chama, adicione um GRANT aqui.
-- =========================================================================

-- 1) fecha tudo
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;

-- 2) funções futuras também nascem fechadas
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;

-- 3) o que o app (usuário logado) pode chamar
grant execute on function
  public.is_admin(),
  public.my_role(),
  public.clear_must_change_password(),
  public.admin_pin_status(),
  public.verify_admin_pin(text),
  public.list_my_events(),
  public.list_stock_status(uuid),
  public.get_my_tickets(),
  public.get_my_station(uuid),
  public.get_ticket_for_validation(text, uuid),
  public.redeem_ticket_items(text, uuid, jsonb, uuid),
  public.undo_redemption(uuid),
  public.create_sale(uuid, jsonb, order_payment_method, order_payment_status, text, boolean, text),
  public.spend_credit(text, uuid, jsonb, uuid),
  public.undo_credit_spend(uuid),
  public.cashier_closing(uuid, uuid),
  public.stock_alerts(numeric),
  public.can_issue_courtesy(),
  public.admin_set_courtesy_permission(uuid, boolean),
  public.list_my_sales(uuid),
  public.regenerate_claim_link(uuid),
  public.confirm_payment(uuid),
  public.event_report(uuid),
  public.admin_set_user_active(uuid, boolean),
  public.admin_cancel_order(uuid),
  public.admin_uncancel_order(uuid),
  public.admin_reopen_ticket_item(uuid, int),
  public.admin_edit_order_item(uuid, int),
  public.admin_add_order_item(uuid, uuid, int),
  public.admin_remove_order_item(uuid),
  public.admin_delete_customer(uuid)
to authenticated;

-- 4) visitante sem login não lê nenhuma tabela (o app só usa usuário logado)
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- 5) funções internas/obsoletas que podem existir no seu banco real mas não
-- fazem mais parte do app (QR rotativo foi removido) — ficam sem acesso:
--   get_rotating_ticket_token, resolve_rotating_token (se existirem)
-- Nada a fazer: o passo 1 já as deixou fechadas.
