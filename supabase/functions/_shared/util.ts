// Utilitários compartilhados pelas Edge Functions.
import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2'
import { corsFor } from './cors.ts'

export class HttpError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export function json(body: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsFor(req), 'Content-Type': 'application/json' },
  })
}

// Envolve o handler: CORS, JSON de erro padronizado e corpo inválido.
export function handle(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsFor(req) })
    try {
      const result = await fn(req)
      return json(result ?? { ok: true }, 200, req)
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 400
      const message = err instanceof Error ? err.message : 'Erro inesperado.'
      if (!(err instanceof HttpError)) console.error('[edge]', message)
      return json({ error: message }, status, req)
    }
  }
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  } catch {
    throw new HttpError('Requisição inválida.')
  }
}

export function env() {
  return {
    url: Deno.env.get('SUPABASE_URL')!,
    anonKey: Deno.env.get('SUPABASE_ANON_KEY')!,
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  }
}

export function adminClient(): SupabaseClient {
  const { url, serviceKey } = env()
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function anonClient(): SupabaseClient {
  const { url, anonKey } = env()
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? ''
  return fwd.split(',')[0].trim() || 'unknown'
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- validações
// Telefone brasileiro: só dígitos, sem o 55 do país. Aceita 10 ou 11 dígitos (DDD + número).
export function normalizePhone(raw: unknown): string {
  let digits = String(raw ?? '').replace(/\D/g, '')
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2)
  return digits
}

export function isValidPhone(digits: string): boolean {
  return digits.length === 10 || digits.length === 11
}

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? '').trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

export const MIN_PASSWORD = 8

// ------------------------------------------------------------------ sessões
export async function authenticate(req: Request): Promise<User> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) throw new HttpError('Não autenticado.', 401)
  const { url, anonKey } = env()
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await caller.auth.getUser()
  if (error || !data.user) throw new HttpError('Não autenticado.', 401)
  return data.user
}

// Exige administrador ativo E, se houver PIN configurado, PIN confirmado (server-side).
export async function requireAdmin(req: Request): Promise<{ admin: SupabaseClient; user: User }> {
  const user = await authenticate(req)
  const admin = adminClient()
  const { data: profile } = await admin.from('profiles').select('role, active').eq('id', user.id).maybeSingle()
  if (!profile || !profile.active || profile.role !== 'admin') {
    throw new HttpError('Você não possui permissão para realizar esta operação.', 403)
  }
  const { data: pinOk, error } = await admin.rpc('admin_pin_ok', { p_user_id: user.id })
  if (error) throw new HttpError('Não foi possível validar a segunda etapa do administrador.', 500)
  if (!pinOk) throw new HttpError('Confirme o código de segunda etapa do administrador.', 403)
  return { admin, user }
}

// -------------------------------------------------- tentativas de login (IP)
// Bloqueia por (conta + IP) rápido e por conta (qualquer IP) de forma mais folgada,
// para que uma pessoa sozinha não consiga trancar a conta dos outros.
const WINDOW_MINUTES = 15

export async function assertNotThrottled(
  admin: SupabaseClient,
  scope: string,
  identifier: string,
  ip: string,
  limits = { perIp: 5, perIdentifier: 25 },
) {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000).toISOString()

  const byIp = await admin
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('scope', scope).eq('identifier', identifier).eq('ip', ip).gte('created_at', since)
  const byId = await admin
    .from('login_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('scope', scope).eq('identifier', identifier).gte('created_at', since)

  if (byIp.error || byId.error) {
    console.error('[throttle]', byIp.error?.message ?? byId.error?.message)
    throw new HttpError('Serviço temporariamente indisponível. Tente novamente.', 503)
  }
  if ((byIp.count ?? 0) >= limits.perIp || (byId.count ?? 0) >= limits.perIdentifier) {
    throw new HttpError(`Muitas tentativas. Tente de novo em ${WINDOW_MINUTES} minutos.`, 429)
  }
}

export async function recordFailure(admin: SupabaseClient, scope: string, identifier: string, ip: string) {
  await admin.from('login_attempts').insert({ scope, identifier, ip })
  if (Math.random() < 0.02) {
    const old = new Date(Date.now() - 24 * 3600_000).toISOString()
    await admin.from('login_attempts').delete().lt('created_at', old)
  }
}

export async function clearFailures(admin: SupabaseClient, scope: string, identifier: string, ip: string) {
  await admin.from('login_attempts').delete().eq('scope', scope).eq('identifier', identifier).eq('ip', ip)
}

// ------------------------------------------------------ e-mail de login (Auth)
// O e-mail guardado no Auth da EQUIPE e dos clientes antigos é sintético
// (staff.<usuario>@... / cliente.<telefone>@...) e, por ser previsível, permitia
// tentar senhas direto na API do Supabase, sem passar pelo limite das funções.
// A partir daqui o e-mail interno é aleatório e é descoberto pelo servidor.
export async function authEmailOf(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId)
  if (error || !data.user?.email) return null
  return data.user.email
}

export function randomInternalEmail(prefix: string): string {
  return `${prefix}.${crypto.randomUUID().replaceAll('-', '')}@eventix.local`
}

const LEGACY_EMAIL = /^(staff|cliente)\..+@eventix\.local$/

// Troca, após um login bem-sucedido, o e-mail previsível por um aleatório.
export async function rotateLegacyEmail(admin: SupabaseClient, userId: string, currentEmail: string) {
  if (!LEGACY_EMAIL.test(currentEmail)) return
  try {
    await admin.auth.admin.updateUserById(userId, {
      email: randomInternalEmail('u'),
      email_confirm: true,
    })
  } catch (err) {
    console.error('[rotateLegacyEmail]', (err as Error).message)
  }
}
