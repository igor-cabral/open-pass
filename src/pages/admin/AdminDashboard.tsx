import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabaseClient'
import { stockAlerts } from '@/services/admin'
import type { StockAlert } from '@/types'

const tabs = [
  { to: '/admin', label: 'Eventos', end: true },
  { to: '/admin/equipe', label: 'Equipe' },
  { to: '/admin/usuarios', label: 'Usuários' },
  { to: '/admin/relatorios', label: 'Relatórios' },
  { to: '/admin/senhas', label: 'Senhas' },
  { to: '/admin/auditoria', label: 'Auditoria' },
]

export default function AdminDashboard() {
  const [pendingCount, setPendingCount] = useState(0)
  const location = useLocation()
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const seenAlerts = useRef<Set<string> | null>(null)

  // Alerta de estoque: produto com 80% ou mais do limite vendido. Avisa com
  // um toast quando um produto passa do limite durante o uso do painel.
  useEffect(() => {
    let alive = true
    async function check() {
      try {
        const list = await stockAlerts(0.8)
        if (!alive) return
        setAlerts(list)
        const keys = new Set(list.map((a) => `${a.product_id}`))
        if (seenAlerts.current) {
          list.filter((a) => !seenAlerts.current!.has(a.product_id)).forEach((a) =>
            toast(`⚠️ ${a.product_name} (${a.event_name}): ${a.pct}% vendido — restam ${a.remaining}`, { duration: 8000 }),
          )
        }
        seenAlerts.current = keys
      } catch {
        /* sem permissão/sessão do PIN ainda: ignora */
      }
    }
    void check()
    const t = setInterval(check, 30000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  useEffect(() => {
    function reload() {
      supabase
        .from('password_reset_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .then(({ count }) => setPendingCount(count || 0))
    }
    reload()
    const channel = supabase
      .channel('password-reset-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'password_reset_requests' }, reload)
      .subscribe()
    const interval = setInterval(reload, 20000)
    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display font-bold text-2xl mb-3">Painel administrativo</h1>
        <div className="flex gap-2 border-b border-line">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                `relative px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                  isActive ? 'border-primary text-primary-dark' : 'border-transparent text-ink/50 hover:text-ink'
                }`
              }
            >
              {t.label}
              {t.to === '/admin/senhas' && pendingCount > 0 && (
                <span className="ml-1.5 inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full bg-red-500 text-white text-xs font-bold">
                  {pendingCount}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </div>
      {alerts.length > 0 && (
        <div className="rounded-2xl border border-danger/40 bg-danger/10 p-4" role="alert">
          <p className="font-display font-semibold text-danger mb-1">⚠️ Estoque acabando</p>
          <ul className="text-sm space-y-0.5">
            {alerts.map((a) => (
              <li key={a.product_id}>
                <b>{a.product_name}</b> <span className="text-ink/60">({a.event_name})</span>: {a.sold}/{a.stock_limit} vendidos
                ({a.pct}%) — {a.remaining === 0 ? <b className="text-danger">esgotado</b> : <>restam <b>{a.remaining}</b></>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div key={location.pathname} className="animate-fade-in-up">
        <Outlet />
      </div>
    </div>
  )
}
