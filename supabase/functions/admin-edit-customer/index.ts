// Edge Function: admin-edit-customer
// Somente admin. Edita nome, telefone e/ou e-mail de um cliente.
// O login do cliente é resolvido pelo servidor a partir de customers.phone /
// customers.email, então trocar o telefone não afeta o acesso. Já o e-mail é
// também o e-mail do Auth, por isso os dois são mantidos em sincronia aqui.

import {
  HttpError, handle, isValidEmail, isValidPhone, normalizeEmail, normalizePhone, readJson, requireAdmin,
} from '../_shared/util.ts'

Deno.serve(handle(async (req) => {
  const { admin, user } = await requireAdmin(req)

  const body = await readJson(req)
  const customerId = String(body.customer_id ?? '')
  if (!customerId) throw new HttpError('Cliente não informado.')

  const { data: customer } = await admin.from('customers').select('phone, email').eq('id', customerId).maybeSingle()
  if (!customer) throw new HttpError('Cliente não encontrado.')

  const changes: Record<string, unknown> = {}

  if (body.phone !== undefined && String(body.phone).trim() !== '') {
    const phone = normalizePhone(body.phone)
    if (!isValidPhone(phone)) throw new HttpError('Telefone inválido.')
    if (phone !== customer.phone) {
      const { data: conflict } = await admin.from('customers').select('id').eq('phone', phone).maybeSingle()
      if (conflict) throw new HttpError('Já existe outro cliente cadastrado com esse telefone.')
      await admin.from('customers').update({ phone }).eq('id', customerId)
      await admin.from('profiles').update({ phone }).eq('id', customerId)
      changes.new_phone = phone
    }
  }

  if (body.email !== undefined && String(body.email).trim() !== '') {
    const email = normalizeEmail(body.email)
    if (!isValidEmail(email)) throw new HttpError('E-mail inválido.')
    if (email !== (customer.email ?? '').toLowerCase()) {
      const { data: conflict } = await admin.from('customers').select('id').eq('email', email).maybeSingle()
      if (conflict) throw new HttpError('Já existe outro cliente cadastrado com esse e-mail.')
      const { error: emailErr } = await admin.auth.admin.updateUserById(customerId, { email, email_confirm: true })
      if (emailErr) throw new HttpError(emailErr.message)
      await admin.from('customers').update({ email }).eq('id', customerId)
      changes.new_email = email
    }
  }

  const fullName = String(body.full_name ?? '').trim()
  if (fullName) {
    await admin.from('profiles').update({ full_name: fullName }).eq('id', customerId)
    changes.new_name = fullName
  }

  await admin.from('audit_logs').insert({
    actor_id: user.id,
    actor_role: 'admin',
    action: 'customer.edit',
    details: { customer_id: customerId, ...changes },
  })

  return { ok: true }
}))
