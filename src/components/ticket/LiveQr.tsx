import { useEffect, useRef, useState } from 'react'
import { QrCode } from './QrCode'
import { liveToken, LIVE_STEP_MS, type LiveToken } from '@/utils/liveQr'

const COLORS = ['#0466FC', '#FDC30B', '#8434BC', '#12C45C']

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// QR que muda a cada 15 s, com relógio em segundos, borda e barras animadas.
// Um print congela tudo isso — o validador vê na hora que a imagem está parada.
// O relógio usa a hora do servidor (corrige celular com horário errado).
export function LiveQr({
  ticketId,
  secret,
  serverNow,
  fetchedAt,
  size = 300,
}: {
  ticketId: string
  secret: string
  serverNow: number
  fetchedAt: number
  size?: number
}) {
  const offset = useRef(serverNow * 1000 - fetchedAt)
  const [now, setNow] = useState(() => Date.now() + offset.current)
  const [tok, setTok] = useState<LiveToken | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    offset.current = serverNow * 1000 - fetchedAt
  }, [serverNow, fetchedAt])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + offset.current), 200)
    return () => clearInterval(id)
  }, [])

  const step = Math.floor(now / LIVE_STEP_MS)
  useEffect(() => {
    let alive = true
    liveToken(ticketId, secret, step)
      .then((t) => alive && (setTok(t), setError('')))
      .catch((e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [ticketId, secret, step])

  const left = 1 - (now % LIVE_STEP_MS) / LIVE_STEP_MS
  const bars = tok
    ? Array.from(tok.mac).flatMap((ch, i) => {
        const n = parseInt(ch, 16)
        return [
          { h: 25 + (n / 15) * 75, c: COLORS[n % 4], d: i * 2 },
          { h: 25 + ((15 - n) / 15) * 75, c: COLORS[(n >> 2) % 4], d: i * 2 + 1 },
        ]
      })
    : []

  return (
    <div className="w-full max-w-[20rem] mx-auto">
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-bold tracking-wide text-success-ink">
          <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
          AO VIVO
        </span>
        <span className="font-mono tabular-nums text-sm font-bold">{clock(now)}</span>
      </div>

      <div className="live-border rounded-[1.7rem] p-[3px]">
        <div className="rounded-[1.5rem] bg-white p-3 flex items-center justify-center min-h-[12rem]">
          {tok ? (
            <QrCode value={tok.token} size={size} />
          ) : error ? (
            <p className="text-sm text-danger text-center p-4">{error}</p>
          ) : (
            <div className="skeleton h-48 w-48 rounded-2xl" />
          )}
        </div>
      </div>

      <div className="mt-3 flex items-end gap-[3px] h-8" aria-hidden>
        {bars.map((b, i) => (
          <span
            key={i}
            className="live-bar flex-1 rounded-sm"
            style={{ height: `${b.h}%`, backgroundColor: b.c, animationDelay: `${b.d * 60}ms` }}
          />
        ))}
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-ink/10 overflow-hidden" aria-hidden>
        <div
          className={`h-full rounded-full ${left < 0.2 ? 'bg-danger' : 'bg-primary'}`}
          style={{ width: `${left * 100}%` }}
        />
      </div>
    </div>
  )
}
