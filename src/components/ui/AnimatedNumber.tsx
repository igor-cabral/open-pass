import { useEffect, useRef, useState } from 'react'

// Número que "rola" até o novo valor (vendas, saldo, placar do telão).
// Sem movimento para quem prefere menos animação.
export function AnimatedNumber({
  value,
  format = (n: number) => String(Math.round(n)),
  duration = 600,
}: {
  value: number
  format?: (n: number) => string
  duration?: number
}) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce || from.current === value) {
      from.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(a + (value - a) * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      from.current = value
    }
  }, [value, duration])

  return <>{format(shown)}</>
}
