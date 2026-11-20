# OpenPass — Instalação do zero

Projeto Supabase: `vbdnzevsjvgozblmvscz` · Repositório: `igor-cabral/open-pass` · Site: `openpass.igorcabral.dev.br`
(Comandos em PowerShell, dentro da pasta do projeto.)

## 1. Supabase — banco

No painel > **SQL Editor**, rode **na ordem**, um por vez (cole o conteúdo e clique *Run*):

| # | Arquivo |
|---|---------|
| 1 | `supabase/sql/01_schema.sql` |
| 2 | `supabase/sql/02_functions.sql` |
| 3 | `supabase/sql/03_policies.sql` |
| 4 | `supabase/sql/04_password_reset.sql` |
| 5 | `supabase/sql/05_admin_improvements.sql` |
| 6 | `supabase/sql/06_sales_limits.sql` |
| 7 | `supabase/sql/07_stock_and_order_edit.sql` |
| 8 | `supabase/sql/08_v2_schema.sql` |
| 9 | `supabase/sql/09_v2_functions.sql` |
| 10 | `supabase/sql/10_v2_extras.sql` |
| 11 | `supabase/sql/11_v2_hardening.sql` |

## 2. Supabase — Auth e primeiro admin

1. **Authentication > Sign In / Providers**: desligue **"Allow new users to sign up"** (contas são criadas só pelas Edge Functions).
2. **Authentication > Users > Add user > Create new user**: e-mail `staff.admin@eventix.local`, senha forte, marque **Auto Confirm User**. Copie o **User UID**.
3. Abra `supabase/sql/12_seed_admin.sql`, troque `COLE_O_UUID_AQUI` pelo UUID e rode.
4. Rode `supabase/sql/13_live_panel.sql` (painel ao vivo) e `supabase/sql/14_live_qr.sql` (QR ao vivo / anti-print).
5. Rode `supabase/local/set_admin_pin.sql` (já contém o seu PIN; esse arquivo **não vai para o Git**).
6. Login no app: usuário `admin` + a senha do passo 2; depois o app pede o PIN.

## 3. Supabase — Edge Functions

```powershell
npx supabase login
npx supabase link --project-ref vbdnzevsjvgozblmvscz
npx supabase functions deploy
npx supabase secrets set ALLOWED_ORIGIN="https://openpass.igorcabral.dev.br,http://localhost:5173"
```

`supabase/config.toml` já marca `verify_jwt = false` nas 8 funções (necessário com a chave `sb_publishable_`; cada função valida o usuário internamente).

## 4. GitHub

```powershell
git init
git branch -M main
git remote add origin https://github.com/igor-cabral/open-pass.git
git add .
git status      # confira: supabase/local/ NÃO pode aparecer
git commit -m "OpenPass: versão inicial"
git push -u origin main
```

## 5. Cloudflare Worker

1. Cloudflare > **Workers & Pages > Create > Import a repository** (GitHub) > `igor-cabral/open-pass`.
2. Nome do Worker: `open-pass` (igual ao `wrangler.jsonc`).
3. Build command: `npm run build` · Deploy command: `npx wrangler deploy`.
4. Depois do deploy: Worker > **Settings > Domains & Routes > Add > Custom domain** > `openpass.igorcabral.dev.br` (o domínio `igorcabral.dev.br` precisa estar na sua conta Cloudflare).

As variáveis `VITE_*` já estão em `.env.production` (são públicas por natureza).

## 6. Testar

Abra o site, entre como `admin`, confirme o PIN, crie evento, produtos, pontos de entrega e equipe.

## Problemas comuns

- **Erro 401 / "Invalid API key" nas chamadas**: use a chave *anon* legada (JWT `eyJ...`) em `.env.production` (Project Settings > API > Legacy keys) e faça novo deploy.
- **Edge Function bloqueada pelo navegador (CORS)**: confira o secret `ALLOWED_ORIGIN`.
- **Mudou o PIN**: rode `select public.set_admin_pin('novo-pin');` no SQL Editor.
