import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { ThemeSwitch } from '@/components/ui/ThemeSwitch'
import { Icon } from '@/components/ui/Icon'
import { OpenPassLogo, DevCredit } from '@/components/ui/Brand'

interface NavItem {
  to: string
  label: string
  icon: string
}

const ICON_ALIAS: Record<string, string> = {
  '🎫': 'ticket', '🧾': 'receipt', '📷': 'scan', '📊': 'dashboard', '📺': 'tv', '👤': 'user', '💰': 'wallet',
}

// Celular: barra de abas embaixo (polegar alcança). Computador: menu lateral.
export function AppShell({ navItems, children }: { navItems: NavItem[]; children: React.ReactNode }) {
  const { profile, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  // "/caixa" não deve ficar ativo em "/caixa/fechamento" quando os dois existem no menu.
  const isEnd = (item: NavItem) => navItems.some((o) => o !== item && o.to.startsWith(item.to + '/'))
  const iconOf = (i: NavItem) => ICON_ALIAS[i.icon] || i.icon

  return (
    <div className="min-h-screen bg-paper md:flex">
      {/* Menu lateral (computador) */}
      <aside className="hidden md:flex md:w-60 md:shrink-0 flex-col sticky top-0 h-screen border-r border-line/50 bg-surface p-4">
        <OpenPassLogo className="h-9 mb-8 self-start" />
        <nav className="flex flex-col gap-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={isEnd(item)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-2xl px-3.5 py-3 text-sm font-semibold transition-all ${
                  isActive ? 'bg-primary text-white shadow-glow' : 'text-ink/65 hover:bg-ink/5 hover:text-ink'
                }`
              }
            >
              <Icon name={iconOf(item)} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto space-y-3 pt-6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium truncate text-ink/70">{profile?.full_name}</span>
            <ThemeSwitch />
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-line py-2.5 text-sm font-semibold text-ink/70 hover:bg-ink/5"
          >
            <Icon name="logout" className="h-4 w-4" /> Sair
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* Cabeçalho (celular) */}
        <header className="md:hidden sticky top-0 z-30 bg-surface/85 backdrop-blur-md border-b border-line/50">
          <div className="flex items-center justify-between px-4 py-2.5">
            <OpenPassLogo className="h-7" />
            <div className="flex items-center gap-3">
              <ThemeSwitch />
              <button
                onClick={handleLogout}
                aria-label="Sair"
                className="h-9 w-9 rounded-xl border border-line flex items-center justify-center text-ink/70"
              >
                <Icon name="logout" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 w-full max-w-5xl mx-auto px-4 md:px-8 py-6 pb-28 md:pb-10">
          <div key={location.pathname} className="animate-fade-in-up">
            {children}
          </div>
        </main>
        <footer className="pb-24 md:pb-6">
          <DevCredit />
        </footer>
      </div>

      {/* Barra de abas (celular) */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/90 backdrop-blur-md border-t border-line/50 safe-bottom"
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={isEnd(item)}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2 text-[11px] font-semibold transition-colors ${
                  isActive ? 'text-primary' : 'text-ink/50'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-8 w-14 items-center justify-center rounded-full transition-all duration-200 ${
                      isActive ? 'bg-primary/10 scale-105' : ''
                    }`}
                  >
                    <Icon name={iconOf(item)} className="h-[1.35rem] w-[1.35rem]" />
                  </span>
                  <span className="leading-none">{item.label.replace('← ', '').replace('Modo ', '')}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
