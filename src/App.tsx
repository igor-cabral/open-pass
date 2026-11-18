import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { ProtectedRoute, homeForRole } from '@/components/layout/ProtectedRoute'
import { AppShell } from '@/components/layout/AppShell'
import { Loading } from '@/components/ui/Loading'
import { InstallPwaPrompt } from '@/components/ui/InstallPwaPrompt'

import LoginPage from '@/pages/auth/LoginPage'
import ChangePasswordPage from '@/pages/auth/ChangePasswordPage'
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage'
import ProfilePage from '@/pages/auth/ProfilePage'
import ClaimPage from '@/pages/auth/ClaimPage'

import MyTicketsPage from '@/pages/customer/MyTicketsPage'
import CashierPage from '@/pages/cashier/CashierPage'
import CashierClosingPage from '@/pages/cashier/CashierClosingPage'
import ValidatorPage from '@/pages/validator/ValidatorPage'

import AdminDashboard from '@/pages/admin/AdminDashboard'
import EventsPage from '@/pages/admin/EventsPage'
import ProductsPage from '@/pages/admin/ProductsPage'
import StationsPage from '@/pages/admin/StationsPage'
import OrdersPage from '@/pages/admin/OrdersPage'
import EquipePage from '@/pages/admin/EquipePage'
import CustomersPage from '@/pages/admin/CustomersPage'
import ReportsPage from '@/pages/admin/ReportsPage'
import PasswordResetsPage from '@/pages/admin/PasswordResetsPage'
import AuditLogPage from '@/pages/admin/AuditLogPage'
import CourtesiesPage from '@/pages/admin/CourtesiesPage'
import LivePanelPage from '@/pages/admin/LivePanelPage'

type NavEntry = { to: string; label: string; icon: string }

// O admin também pode trabalhar como caixa ou validador com o mesmo login:
// estes atalhos aparecem em todas as telas dele.
const ADMIN_NAV: NavEntry[] = [
  { to: '/admin', label: 'Painel', icon: 'dashboard' },
  { to: '/caixa', label: 'Modo Caixa', icon: 'receipt' },
  { to: '/validador', label: 'Modo Validador', icon: 'scan' },
  { to: '/ao-vivo', label: 'Ao vivo', icon: 'tv' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
]

function CustomerShell() {
  return (
    <AppShell
      navItems={[
        { to: '/meus-tickets', label: 'Meus tickets', icon: 'ticket' },
        { to: '/perfil', label: 'Perfil', icon: 'user' },
      ]}
    >
      <MyTicketsPage />
    </AppShell>
  )
}

const CASHIER_NAV = [
  { to: '/caixa', label: 'Vender', icon: 'receipt' },
  { to: '/caixa/fechamento', label: 'Fechamento', icon: 'wallet' },
  { to: '/perfil', label: 'Perfil', icon: 'user' },
]

function CashierShell({ closing = false }: { closing?: boolean }) {
  const { profile } = useAuth()
  const nav: NavEntry[] =
    profile?.role === 'admin'
      ? [
          { to: '/admin', label: '← Painel admin', icon: 'dashboard' },
          { to: '/caixa', label: 'Vender', icon: 'receipt' },
          { to: '/caixa/fechamento', label: 'Fechamento', icon: 'wallet' },
          { to: '/validador', label: 'Modo Validador', icon: 'scan' },
        ]
      : CASHIER_NAV
  return (
    <AppShell navItems={nav}>
      {closing ? <CashierClosingPage /> : <CashierPage />}
    </AppShell>
  )
}

function ValidatorShell() {
  const { profile } = useAuth()
  const nav: NavEntry[] =
    profile?.role === 'admin'
      ? [
          { to: '/admin', label: '← Painel admin', icon: 'dashboard' },
          { to: '/validador', label: 'Validar', icon: 'scan' },
          { to: '/caixa', label: 'Modo Caixa', icon: 'receipt' },
        ]
      : [
          { to: '/validador', label: 'Validar', icon: 'scan' },
          { to: '/perfil', label: 'Perfil', icon: 'user' },
        ]
  return (
    <AppShell navItems={nav}>
      <ValidatorPage />
    </AppShell>
  )
}

function AdminShell() {
  return (
    <AppShell navItems={ADMIN_NAV}>
      <AdminDashboard />
    </AppShell>
  )
}

// /perfil é uma única rota acessível a qualquer papel logado; escolhe o
// conjunto de abas do topo de acordo com o papel pra manter a navegação
// consistente com a tela de onde a pessoa veio.
function ProfileShell() {
  const { profile } = useAuth()
  const navByRole: Record<string, { to: string; label: string; icon: string }[]> = {
    admin: ADMIN_NAV,
    cashier: CASHIER_NAV,
    validator: [
      { to: '/validador', label: 'Validar', icon: 'scan' },
      { to: '/perfil', label: 'Perfil', icon: 'user' },
    ],
    customer: [
      { to: '/meus-tickets', label: 'Meus tickets', icon: 'ticket' },
      { to: '/perfil', label: 'Perfil', icon: 'user' },
    ],
  }
  return (
    <AppShell navItems={navByRole[profile?.role || 'customer']}>
      <ProfilePage />
    </AppShell>
  )
}

function RootRedirect() {
  const { profile, loading } = useAuth()
  if (loading) return <Loading />
  if (!profile) return <Navigate to="/login" replace />
  if (profile.must_change_password) return <Navigate to="/trocar-senha" replace />
  return <Navigate to={homeForRole(profile.role)} replace />
}

export default function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <ThemeProvider>
      <AuthProvider>
        <Toaster position="top-center" toastOptions={{ duration: 4000 }} />
        <InstallPwaPrompt />
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
          <Route path="/trocar-senha" element={<ChangePasswordPage />} />
          {/* link/QR que o caixa entrega: o cliente cria a conta (ou entra) e o ingresso passa a ser dele */}
          <Route path="/t/:token" element={<ClaimPage />} />

          <Route
            path="/perfil"
            element={
              <ProtectedRoute roles={['admin', 'cashier', 'validator', 'customer']}>
                <ProfileShell />
              </ProtectedRoute>
            }
          />

          <Route
            path="/meus-tickets"
            element={
              <ProtectedRoute roles={['customer']}>
                <CustomerShell />
              </ProtectedRoute>
            }
          />

          <Route
            path="/caixa"
            element={
              <ProtectedRoute roles={['cashier', 'admin']}>
                <CashierShell />
              </ProtectedRoute>
            }
          />

          <Route
            path="/caixa/fechamento"
            element={
              <ProtectedRoute roles={['cashier', 'admin']}>
                <CashierShell closing />
              </ProtectedRoute>
            }
          />

          <Route
            path="/validador"
            element={
              <ProtectedRoute roles={['validator', 'admin']}>
                <ValidatorShell />
              </ProtectedRoute>
            }
          />

          {/* telão da coordenação: tela cheia, sem menu */}
          <Route
            path="/ao-vivo"
            element={
              <ProtectedRoute roles={['admin']}>
                <LivePanelPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={['admin']}>
                <AdminShell />
              </ProtectedRoute>
            }
          >
            <Route index element={<EventsPage />} />
            <Route path="equipe" element={<EquipePage />} />
            <Route path="usuarios" element={<CustomersPage />} />
            <Route path="relatorios" element={<ReportsPage />} />
            <Route path="senhas" element={<PasswordResetsPage />} />
            <Route path="auditoria" element={<AuditLogPage />} />
            <Route path="cortesias" element={<CourtesiesPage />} />
            <Route path="eventos/:eventId/produtos" element={<ProductsPage />} />
            <Route path="eventos/:eventId/pontos" element={<StationsPage />} />
            <Route path="eventos/:eventId/pedidos" element={<OrdersPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  )
}
