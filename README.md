# OpenPass — Ingressos digitais

Site: https://openpass.igorcabral.dev.br · Desenvolvido por [Igor Cabral](https://igorcabral.dev.br)

Frontend estático (React + Vite + Tailwind, PWA) num Cloudflare Worker (ver `wrangler.jsonc`); dados, login e
regras no Supabase (Postgres + Auth + Edge Functions). Sem servidor para manter.

## Como funciona (v2)

1. **Caixa só vende.** Escolhe os produtos, forma de pagamento e finaliza. O sistema
   gera o ingresso e um **link aleatório** (`/t/<token>`) com **QR code** na tela.
2. **Cliente resgata.** Abre o link/QR, preenche Nome, Telefone, E-mail e senha
   (ou entra numa conta existente) e o ingresso fica na conta dele. O link vale uma vez;
   o banco guarda só o hash do token.
3. **Pontos de entrega.** O admin cria pontos por evento (Bar, Cozinha, Ficha…), marca
   quais produtos cada ponto entrega e atribui cada validador a um ponto (tela *Equipe*).
   O validador só consegue dar baixa nos produtos do seu ponto.
4. **Validação.** O cliente mostra o QR do ingresso (só aparece no dia do evento);
   o validador escaneia, escolhe as quantidades e confirma. A baixa é idempotente
   (toque duplo não entrega duas vezes) e dá para desfazer a última entrega.
5. **Ficha digital (opcional).** Produto especial: o caixa digita o valor do crédito, o ingresso nasce com
   saldo e o validador cobra produtos do saldo no ponto de entrega.
6. **Cortesias, fechamento de caixa, alerta de estoque (80%) e exportação CSV/PDF** para a prestação de contas.
7. **Pagamento pendente** bloqueia a entrega até o admin/caixa confirmar.

Evento sem nenhum ponto criado funciona como antes: qualquer validador entrega tudo.

## Instalar

Veja **[docs/INSTALACAO.md](docs/INSTALACAO.md)** (Supabase, Edge Functions, GitHub e Cloudflare Worker).

Local: `npm install` e `npm run dev` (as variáveis já estão em `.env.development`).

## Segurança

- Login de cliente e equipe passa por Edge Functions com limite de tentativas por conta e IP.
- Permissões das funções SQL fechadas por padrão (`11_v2_hardening.sql`); visitante sem login não lê tabelas.
- PIN do admin validado no servidor (defina com `select public.set_admin_pin('seu-pin');`).
- **Desative o cadastro público** em Supabase → Authentication → Sign In / Providers
  ("Allow new users to sign up" desligado). As contas são criadas só pelas Edge Functions.
- Nunca coloque a `service_role` no frontend.
