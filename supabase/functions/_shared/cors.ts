// Origens permitidas. Para mudar sem editar código, defina o secret ALLOWED_ORIGIN
// (uma origem, ou várias separadas por vírgula).
const ALLOWED = (Deno.env.get('ALLOWED_ORIGIN') ??
  'https://openpass.igorcabral.dev.br,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

// Devolve os cabeçalhos CORS para a origem da requisição (só se estiver na lista).
export function corsFor(req?: Request) {
  const origin = req?.headers.get('Origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED.includes('*') ? '*' : ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
