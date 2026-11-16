// Edge Function: claim-ticket
// Resgate do ingresso. O caixa só vende e entrega um LINK/QR (/t/<token>); o
// cliente abre o link e:
//   action "peek"   -> vê o que comprou (sem login)
//   action "create" -> cria a conta (nome, telefone, e-mail, senha) e o ingresso
//                      já entra nela; devolve a sessão (fica logado)
//   action "attach" -> já tem conta e está logado: vincula o ingresso a ela
//
// O token só existe no link; o banco guarda apenas o hash SHA-256.

import {
  adminClient, anonClient, assertNotThrottled, authenticate, clientIp, handle, HttpError, isValidEmail,
  isValidPhone, MIN_PASSWORD, normalizeEmail, normalizePhone, readJson, recordFailure, sha256Hex,
} from '../_shared/util.ts'

const INVALID = 'Link inválido ou já utilizado.'

Deno.serve(handle(async (req) => {
  const body = await readJson(req)
  const action = String(body.action ?? '')
  const token = String(body.token ?? '').trim()
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw new HttpError(INVALID)

  const ip = clientIp(req)
  const admin = adminClient()
  // tentar adivinhar tokens (192 bits, inviável) ou usar o link para sondar contas
  await assertNotThrottled(admin, 'claim', '-', ip, { perIp: 20, perIdentifier: 2000 })
  const tokenHash = await sha256Hex(token)

  async function peek() {
    const { data, error } = await admin.rpc('peek_claim', { p_token_hash: tokenHash })
    if (error) {
      await recordFailure(admin, 'claim', '-', ip)
      throw new HttpError(error.message || INVALID)
    }
    return data
  }

  if (action === 'peek') return await peek()

  if (action === 'attach') {
    const user = await authenticate(req)
    const { data: profile } = await admin.from('profiles').select('role, active').eq('id', user.id).maybeSingle()
    if (!profile || !profile.active || profile.role !== 'customer') {
      throw new HttpError('Entre com uma conta de cliente para vincular o ingresso.', 403)
    }
    const { error } = await admin.rpc('claim_ticket', { p_token_hash: tokenHash, p_customer_id: user.id })
    if (error) {
      await recordFailure(admin, 'claim', '-', ip)
      throw new HttpError(error.message || INVALID)
    }
    return { ok: true }
  }

  if (action !== 'create') throw new HttpError('Ação inválida.')

  // ------------------------------------------------------------ criar conta
  const fullName = String(body.full_name ?? '').trim().replace(/\s+/g, ' ')
  const phone = normalizePhone(body.phone)
  const email = normalizeEmail(body.email)
  const password = String(body.password ?? '')

  if (fullName.length < 3 || fullName.length > 80) throw new HttpError('Informe seu nome completo.')
  if (!isValidPhone(phone)) throw new HttpError('Informe o telefone com DDD (ex.: 47 99999-9999).')
  if (!isValidEmail(email)) throw new HttpError('Informe um e-mail válido.')
  if (password.length < MIN_PASSWORD) throw new HttpError(`A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`)

  await peek() // o link ainda vale?

  const { data: phoneTaken } = await admin.from('customers').select('id').eq('phone', phone).maybeSingle()
  if (phoneTaken) {
    throw new HttpError('Já existe uma conta com este telefone. Use "Já tenho conta" para entrar e vincular o ingresso.')
  }
  const { data: emailTaken } = await admin.from('customers').select('id').eq('email', email).maybeSingle()
  if (emailTaken) {
    throw new HttpError('Já existe uma conta com este e-mail. Use "Já tenho conta" para entrar e vincular o ingresso.')
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // o link do caixa é a prova de compra; não exigimos confirmação por e-mail
    user_metadata: { full_name: fullName, role: 'customer' },
  })
  if (createErr || !created.user) {
    if (/already|registered|exists/i.test(createErr?.message ?? '')) {
      throw new HttpError('Já existe uma conta com este e-mail. Use "Já tenho conta" para entrar e vincular o ingresso.')
    }
    throw new HttpError(createErr?.message || 'Não foi possível criar a conta.')
  }
  const userId = created.user.id

  const rollback = async () => {
    await admin.auth.admin.deleteUser(userId) // apaga profiles/customers em cascata
  }

  const { error: profileErr } = await admin.from('profiles').insert({
    id: userId,
    role: 'customer',
    full_name: fullName,
    phone,
    must_change_password: false,
    active: true,
  })
  if (profileErr) {
    await rollback()
    throw new HttpError('Não foi possível criar o perfil. Tente novamente.')
  }

  const { error: customerErr } = await admin.from('customers').insert({ id: userId, phone, email })
  if (customerErr) {
    await rollback()
    throw new HttpError('Não foi possível concluir o cadastro. Tente novamente.')
  }

  const { error: claimErr } = await admin.rpc('claim_ticket', { p_token_hash: tokenHash, p_customer_id: userId })
  if (claimErr) {
    await rollback()
    await recordFailure(admin, 'claim', '-', ip)
    throw new HttpError(claimErr.message || INVALID)
  }

  const { data: session } = await anonClient().auth.signInWithPassword({ email, password })
  if (!session?.session) return { ok: true, logged_in: false }

  return {
    ok: true,
    logged_in: true,
    access_token: session.session.access_token,
    refresh_token: session.session.refresh_token,
  }
}))
