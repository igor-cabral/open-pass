-- =========================================================================
-- OpenPass — CRIAR O PRIMEIRO ADMINISTRADOR
-- [12/12] Execute por último, depois de 01 a 11.
--
-- O app não tem tela de "criar admin" (por segurança ninguém se auto-promove
-- a admin). O primeiro administrador é criado uma única vez, pelo painel:
--
-- 1. Supabase > Authentication > Users > "Add user" > "Create new user".
-- 2. E-mail: staff.admin@eventix.local
--    (o app converte o usuário "admin" em "staff.admin@eventix.local" no login;
--     o e-mail PRECISA ser exatamente esse, é um identificador interno.
--     Após o primeiro login, o sistema troca esse e-mail por um aleatório.)
--    Senha: escolha uma senha forte (é a senha de login do admin).
--    Marque "Auto Confirm User".
-- 3. Copie o UUID do usuário criado (coluna "User UID").
-- 4. Troque COLE_O_UUID_AQUI abaixo pelo UUID (mantenha as aspas) e execute.
--
-- Depois, defina o PIN de segunda etapa do admin (arquivo local, fora do Git):
--   supabase/local/set_admin_pin.sql
-- =========================================================================

insert into public.profiles (id, role, full_name, username, must_change_password, active)
values ('COLE_O_UUID_AQUI', 'admin', 'Administrador', 'admin', false, true)
on conflict (id) do update set role = 'admin', active = true;
