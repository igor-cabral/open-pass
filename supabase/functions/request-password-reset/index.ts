// Edge Function: request-password-reset
// Pública (quem esqueceu a senha não consegue logar). Cria uma solicitação
// pendente que o admin vê no painel e resolve manualmente.
// Aceita telefone, e-mail (cliente) ou usuário (equipe). A resposta é sempre a
// mesma, exista a conta ou não.

import {
  adminClient, handle, HttpError, isValidPhone, normalizeEmail, normalizePhone, readJson,
} from '../_shared/util.ts'

const RESPONSE = {
  ok: true,
  message: 'Solicitação enviada! Um administrador vai entrar em contato para redefinir sua senha.',
}

Deno.serve(handle(async (req) => {
  const body = await readJson(req)
  const raw = String(body.identifier ?? '').trim()
  if (!raw || raw.length > 120) throw new HttpError('Informe seu telefone, e-mail ou usuário.')

  const admin = adminClient()
  let targetRole: 'customer' | 'staff'
  let profileId: string | null = null
  let identifierToStore: string

  if (raw.includes('@')) {
    targetRole = 'customer'
    identifierToStore = normalizeEmail(raw)
    const { data } = await admin.from('customers').select('id').eq('email', identifierToStore).maybeSingle()
    profileId = data?.id ?? null
  } else if (isValidPhone(normalizePhone(raw))) {
    targetRole = 'customer'
    identifierToStore = normalizePhone(raw)
    const { data } = await admin.from('customers').select('id').eq('phone', identifierToStore).maybeSingle()
    profileId = data?.id ?? null
  } else {
    targetRole = 'staff'
    identifierToStore = raw.toLowerCase()
    const { data } = await admin.from('profiles').select('id').eq('username', identifierToStore).maybeSingle()
    profileId = data?.id ?? null
  }

  const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString()

  // no máximo 3 pedidos por conta por hora…
  const perId = await admin
    .from('password_reset_requests')
    .select('id', { count: 'exact', head: true })
    .eq('identifier', identifierToStore)
    .gte('requested_at', hourAgo)
  // …e um teto geral por hora, para ninguém lotar a fila do admin com pedidos inventados
  const overall = await admin
    .from('password_reset_requests')
    .select('id', { count: 'exact', head: true })
    .gte('requested_at', hourAgo)

  if ((perId.count ?? 0) >= 3 || (overall.count ?? 0) >= 60) return RESPONSE

  await admin.from('password_reset_requests').insert({
    target_role: targetRole,
    identifier: identifierToStore,
    profile_id: profileId,
  })

  return RESPONSE
}))
