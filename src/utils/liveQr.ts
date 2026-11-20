// QR ao vivo (anti-print). O QR do cliente carrega uma assinatura (HMAC-SHA256) que muda
// a cada 15 segundos; o servidor confere em resolve_live_qr. Um print só vale por ~45 s.
// Formato: OP1.<id do ingresso, 32 hex maiúsculos>.<janela>.<assinatura, 16 hex maiúsculos>

export const LIVE_STEP_MS = 15000

export function ticketHexId(ticketId: string): string {
  return ticketId.replace(/-/g, '').toUpperCase()
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Abra o ingresso em uma conexão segura (https).')
  const enc = new TextEncoder()
  const key = await subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await subtle.sign('HMAC', key, enc.encode(message)))
  return Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface LiveToken {
  token: string
  mac: string
  step: number
}

export async function liveToken(ticketId: string, secret: string, step: number): Promise<LiveToken> {
  const hex = ticketHexId(ticketId)
  const mac = (await hmacHex(secret, `${hex}.${step}`)).slice(0, 16).toUpperCase()
  return { token: `OP1.${hex}.${step}.${mac}`, mac, step }
}
