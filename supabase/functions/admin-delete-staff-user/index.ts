// Edge Function: admin-delete-staff-user
// Somente admin. Exclui definitivamente um caixa/validador SEM histórico.
// Com histórico (vendas, entregas, auditoria) só é possível desativar.

import { HttpError, handle, readJson, requireAdmin } from '../_shared/util.ts'

Deno.serve(handle(async (req) => {
  const { admin, user } = await requireAdmin(req)

  const body = await readJson(req)
  const userId = String(body.user_id ?? '')
  if (!userId) throw new HttpError('Informe o usuário a excluir.')

  const { data: target } = await admin.from('profiles').select('role, username').eq('id', userId).maybeSingle()
  if (!target) throw new HttpError('Usuário não encontrado.')
  if (!['cashier', 'validator'].includes(target.role)) {
    throw new HttpError('Só é possível excluir usuários de caixa ou validação por aqui.')
  }

  const { data: hasHistory, error: rpcErr } = await admin.rpc('staff_has_history', { p_user_id: userId })
  if (rpcErr) throw new HttpError('Não foi possível verificar o histórico do usuário.')
  if (hasHistory) {
    throw new HttpError(
      'Não é possível excluir: este usuário já tem vendas ou validações registradas. Você pode apenas desativá-lo.',
    )
  }

  const { error: deleteErr } = await admin.auth.admin.deleteUser(userId)
  if (deleteErr) throw new HttpError(deleteErr.message)

  await admin.from('audit_logs').insert({
    actor_id: user.id,
    actor_role: 'admin',
    action: 'user.delete',
    details: { user_id: userId, username: target.username, role: target.role },
  })

  return { ok: true }
}))
