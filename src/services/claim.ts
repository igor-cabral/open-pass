import { callFunction } from '@/lib/api'
import type { ClaimPreview } from '@/types'

export function peekClaim(token: string): Promise<ClaimPreview> {
  return callFunction<ClaimPreview>('claim-ticket', { action: 'peek', token })
}

export interface NewAccountInput {
  token: string
  full_name: string
  phone: string
  email: string
  password: string
}

export interface ClaimSession {
  ok: boolean
  logged_in: boolean
  access_token?: string
  refresh_token?: string
}

// Cria a conta do cliente e já vincula o ingresso a ela.
export function claimWithNewAccount(input: NewAccountInput): Promise<ClaimSession> {
  return callFunction<ClaimSession>('claim-ticket', { action: 'create', ...input })
}

// Cliente já logado: vincula o ingresso à conta dele.
export function claimToCurrentAccount(token: string): Promise<{ ok: boolean }> {
  return callFunction<{ ok: boolean }>('claim-ticket', { action: 'attach', token }, { auth: true })
}
