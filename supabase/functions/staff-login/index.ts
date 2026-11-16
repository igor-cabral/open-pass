// Edge Function: staff-login
// Login da equipe (caixa/validador/admin) por usuário e senha.
// - Limite de tentativas por (usuário + IP) e por usuário (tabela login_attempts).
// - O e-mail interno do Auth é descoberto aqui no servidor (não é derivável do usuário).

import {
  adminClient, anonClient, assertNotThrottled, authEmailOf, clearFailures, clientIp, handle,
  HttpError, readJson, recordFailure, rotateLegacyEmail,
} from '../_shared/util.ts'

const GENERIC = 'Usuário ou senha inválidos.'

Deno.serve(handle(async (req) => {
  const body = await readJson(req)
  const username = String(body.username ?? '').trim().toLowerCase()
  const password = String(body.password ?? '')
  if (!username || !password) throw new HttpError(GENERIC)

  const ip = clientIp(req)
  const admin = adminClient()
  await assertNotThrottled(admin, 'staff', username, ip)

  const { data: profile } = await admin
    .from('profiles')
    .select('id, active, role')
    .eq('username', username)
    .maybeSingle()

  const email = profile && profile.role !== 'customer' ? await authEmailOf(admin, profile.id) : null
  if (!profile || !email) {
    await recordFailure(admin, 'staff', username, ip)
    throw new HttpError(GENERIC)
  }

  const { data, error } = await anonClient().auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    await recordFailure(admin, 'staff', username, ip)
    throw new HttpError(GENERIC)
  }

  // só depois de provar a senha é que se informa que a conta está bloqueada
  if (!profile.active) throw new HttpError('Usuário bloqueado. Fale com o administrador.')

  await clearFailures(admin, 'staff', username, ip)
  await rotateLegacyEmail(admin, profile.id, email)

  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
}))
