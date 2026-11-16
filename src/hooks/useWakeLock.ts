import { useEffect } from 'react'

// Mantém a tela acesa enquanto `active` for true (útil com o QR na tela).
// Navegadores não deixam um site forçar o brilho; isso evita que a tela
// apague/escureça na fila. Se o aparelho não suportar, simplesmente não faz nada.
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nav = navigator as any
    if (!nav.wakeLock?.request) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let lock: any = null
    let cancelled = false

    async function acquire() {
      try {
        lock = await nav.wakeLock.request('screen')
        if (cancelled) void lock.release()
      } catch {
        /* negado (economia de bateria etc.) — ignorado */
      }
    }
    function onVisible() {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      void lock?.release?.().catch?.(() => {})
    }
  }, [active])
}
