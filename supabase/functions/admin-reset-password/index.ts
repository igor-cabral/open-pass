// Edge Function: admin-reset-password
// Somente admin. Define uma nova senha para quem pediu "esqueci minha senha"
// (cliente ou equipe), obriga a troca no próximo login e limpa o bloqueio.

import { HttpError, handle, MIN_PASSWORD, readJson, requireAdmin } from '../_shared/util.ts'

Deno.serve(handle(async (req) => {
  const { admin, user } = await requireAdmin(req)

  const body = await readJson(req)
  const requestId = String(body.request_id ?? '')
  const newPassword = String(body.new_password ?? '')
  if (!requestId || newPassword.length < MIN_PASSWORD) {
    throw new HttpError(`Informe uma senha com pelo menos ${MIN_PASSWORD} caracteres.`)
  }

  const { data: request } = await admin
    .from('password_reset_requests')
    .select('id, profile_id, status')
    .eq('id', requestId)
    .maybeSingle()
  if (!request) throw new HttpError('Solicitação não encontrada.')
  if (!request.profile_id) {
    throw new HttpError('Não foi possível localizar automaticamente essa conta — confira o telefone/e-mail/usuário.')
  }

  const { error: pwErr } = await admin.auth.admin.updateUserById(request.profile_id, { password: newPassword })
  if (pwErr) throw new HttpError(pwErr.message)
  await admin.from('profiles').update({ must_change_password: true }).eq('id', request.profile_id)

  // limpa o bloqueio por tentativas (todas as chaves possíveis dessa conta)
  const keys: string[] = []
  const { data: prof } = await admin.from('profiles').select('username').eq('id', request.profile_id).maybeSingle()
  if (prof?.username) keys.push(String(prof.username).toLowerCase())
  const { data: cust } = await admin.from('customers').select('phone, email').eq('id', request.profile_id).maybeSingle()
  if (cust?.phone) keys.push(cust.phone)
  if (cust?.email) keys.push(String(cust.email).toLowerCase())
  if (keys.length) await admin.from('login_attempts').delete().in('identifier', keys)

  await admin
    .from('password_reset_requests')
    .update({ status: 'done', resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq('id', requestId)

  await admin.from('audit_logs').insert({
    actor_id: user.id,
    actor_role: 'admin',
    action: 'password_reset.resolve',
    details: { request_id: requestId, profile_id: request.profile_id },
  })

  return { ok: true }
}))
