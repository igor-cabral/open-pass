import { supabase, FUNCTIONS_URL } from '@/lib/supabaseClient'

// Chama uma Edge Function. `auth: true` envia o token do usuário logado;
// sem isso vai a chave anon (funções públicas: login, resgate de ingresso).
export async function callFunction<T = unknown>(
  name: string,
  body: Record<string, unknown>,
  options: { auth?: boolean } = {},
): Promise<T> {
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string
  let bearer = anonKey
  if (options.auth) {
    const { data } = await supabase.auth.getSession()
    if (!data.session) throw new Error('Sua sessão expirou. Entre novamente.')
    bearer = data.session.access_token
  }

  let res: Response
  try {
    res = await fetch(`${FUNCTIONS_URL}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}`, apikey: anonKey },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.')
  }

  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((json as { error?: string }).error || 'Não foi possível concluir a operação.')
  return json as T
}
