// Edge Function: create-staff-user
// Somente admin. Cria login de CAIXA ou VALIDADOR (usuário/senha definidos
// pelo admin). O e-mail interno do Auth é aleatório (não derivável do usuário).

import { HttpError, handle, MIN_PASSWORD, randomInternalEmail, readJson, requireAdmin } from '../_shared/util.ts'

Deno.serve(handle(async (req) => {
  const { admin, user } = await requireAdmin(req)

  const body = await readJson(req)
  const fullName = String(body.full_name ?? '').trim()
  const username = String(body.username ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '')
  const password = String(body.password ?? '')
  const role = String(body.role ?? '')

  if (!fullName || !username || !password || !role) throw new HttpError('Preencha nome, usuário, senha e tipo.')
  if (!['cashier', 'validator'].includes(role)) throw new HttpError('Tipo de usuário inválido.')
  if (password.length < MIN_PASSWORD) throw new HttpError(`A senha deve ter ao menos ${MIN_PASSWORD} caracteres.`)

  const { data: existing } = await admin.from('profiles').select('id').eq('username', username).maybeSingle()
  if (existing) throw new HttpError('Já existe um usuário com esse login.')

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: randomInternalEmail('s'),
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, username, role },
  })
  if (createErr || !created.user) throw new HttpError(createErr?.message || 'Não foi possível criar o usuário.')
  const newUserId = created.user.id

  const { error: profileErr } = await admin.from('profiles').insert({
    id: newUserId,
    role,
    full_name: fullName,
    username,
    must_change_password: true,
    active: true,
    created_by: user.id,
  })
  if (profileErr) {
    await admin.auth.admin.deleteUser(newUserId) // não deixa usuário órfão no Auth
    throw new HttpError(profileErr.message)
  }

  await admin.from('audit_logs').insert({
    actor_id: user.id,
    actor_role: 'admin',
    action: 'staff_user.create',
    details: { user_id: newUserId, role, username },
  })

  return { user_id: newUserId, username }
}))
