// Edge Function: customer-login
// Login do cliente por TELEFONE ou E-MAIL + senha (a conta é criada no resgate
// do ingresso, pela função claim-ticket).

import {
  adminClient, anonClient, assertNotThrottled, authEmailOf, clearFailures, clientIp, handle,
  HttpError, isValidPhone, normalizeEmail, normalizePhone, readJson, recordFailure, rotateLegacyEmail,
} from '../_shared/util.ts'

const GENERIC = 'Telefone/e-mail ou senha inválidos.'

Deno.serve(handle(async (req) => {
  const body = await readJson(req)
  const identifier = String(body.identifier ?? '').trim()
  const password = String(body.password ?? '')
  if (!identifier || !password) throw new HttpError(GENERIC)

  const byEmail = identifier.includes('@')
  const key = byEmail ? normalizeEmail(identifier) : normalizePhone(identifier)
  if (!byEmail && !isValidPhone(key)) throw new HttpError(GENERIC)

  const ip = clientIp(req)
  const admin = adminClient()
  await assertNotThrottled(admin, 'customer', key, ip)

  const { data: customer } = await admin
    .from('customers')
    .select('id')
    .eq(byEmail ? 'email' : 'phone', key)
    .maybeSingle()

  const email = customer ? await authEmailOf(admin, customer.id) : null
  if (!customer || !email) {
    await recordFailure(admin, 'customer', key, ip)
    throw new HttpError(GENERIC)
  }

  const { data, error } = await anonClient().auth.signInWithPassword({ email, password })
  if (error || !data.session) {
    await recordFailure(admin, 'customer', key, ip)
    throw new HttpError(GENERIC)
  }

  const { data: profile } = await admin.from('profiles').select('active').eq('id', customer.id).maybeSingle()
  if (!profile?.active) throw new HttpError('Conta bloqueada. Fale com a organização do evento.')

  await clearFailures(admin, 'customer', key, ip)
  await rotateLegacyEmail(admin, customer.id, email)

  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token }
}))
