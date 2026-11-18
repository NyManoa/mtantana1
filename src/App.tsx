import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { EspaceGuard } from "@/components/EspaceGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EspaceProvider, useEspace } from "@/lib/espace";
import { ToastProvider, useToast } from "@/components/Toast";
import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { SyncProvider } from "@/lib/sync";
import { DriveAutoBackup } from "@/lib/useDriveBackup";
import { AuthPage } from "@/pages/AuthPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { SaisiePage } from "@/pages/SaisiePage";
import { DashboardPage } from "@/pages/DashboardPage";
import { TransactionsPage } from "@/pages/TransactionsPage";
import { AuditPage } from "@/pages/AuditPage";
import { UsersPage } from "@/pages/UsersPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { BudgetsPage } from "@/pages/BudgetsPage";
import { RecurringPage } from "@/pages/RecurringPage";
import { AlertsPage } from "@/pages/AlertsPage";
import { ImportPage } from "@/pages/ImportPage";
import type { Role } from "@/lib/db";

const roleRank: Record<Role, number> = { operateur: 0, superviseur: 1, admin: 2 };

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1220]" role="status" aria-label="Chargement">
      <div className="h-8 w-8 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 spin-slow" />
    </div>
  );
}

function RoleGate({ minRole, cloudOnly, children }: { minRole?: Role; cloudOnly?: boolean; children: ReactNode }) {
  const { role } = useEspace();
  const { mode } = useAuth();
  if (cloudOnly && mode !== "cloud") return <Navigate to="/settings" replace />;
  if (minRole && roleRank[role] < roleRank[minRole]) return <Navigate to="/saisie" replace />;
  return <>{children}</>;
}

function ProtectedRoute({ children, minRole, cloudOnly }: { children: ReactNode; minRole?: Role; cloudOnly?: boolean }) {
  const { session, loading, recovery } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!session) return <Navigate to="/login" state={{ from: location }} replace />;
  if (recovery) return <Navigate to="/reset-password" replace />;
  return (
    <EspaceGuard>
      <RoleGate minRole={minRole} cloudOnly={cloudOnly}>{children}</RoleGate>
    </EspaceGuard>
  );
}

function Home() {
  const { session, loading } = useAuth();
  const { role, loading: espLoading } = useEspace();
  if (loading || (session && espLoading)) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  return <Navigate to={role === "operateur" ? "/saisie" : "/dashboard"} replace />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  if (loading) return <Spinner />;
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><AuthPage mode="signup" /></PublicOnly>} />
      <Route path="/forgot-password" element={<PublicOnly><AuthPage mode="forgot" /></PublicOnly>} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      <Route path="/saisie" element={<ProtectedRoute><SaisiePage /></ProtectedRoute>} />
      <Route path="/transactions" element={<ProtectedRoute><TransactionsPage /></ProtectedRoute>} />
      <Route path="/recurring" element={<ProtectedRoute><RecurringPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
      <Route path="/dashboard" element={<ProtectedRoute minRole="superviseur"><DashboardPage /></ProtectedRoute>} />
      <Route path="/budgets" element={<ProtectedRoute minRole="superviseur"><BudgetsPage /></ProtectedRoute>} />
      <Route path="/alerts" element={<ProtectedRoute minRole="superviseur"><AlertsPage /></ProtectedRoute>} />
      <Route path="/import" element={<ProtectedRoute minRole="admin"><ImportPage /></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute minRole="admin"><AuditPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute minRole="admin" cloudOnly><UsersPage /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function WithSync({ children }: { children: ReactNode }) {
  const { mode, profile } = useAuth();
  return (
    <SyncProvider userId={profile?.id ?? null} enabled={mode === "cloud"}>
      {profile && <DriveAutoBackup />}
      {children}
    </SyncProvider>
  );
}

/** Message quand des invitations à des espaces partagés viennent d'être acceptées. */
function InvitationNotice() {
  const { lang } = useAuth();
  const { show } = useToast();
  useEffect(() => {
    const onAccepted = (e: Event) => show(t(lang, "invitationsAccepted", { n: (e as CustomEvent<number>).detail }), "success");
    window.addEventListener("mtantana:invitations-accepted", onAccepted);
    return () => window.removeEventListener("mtantana:invitations-accepted", onAccepted);
  }, [lang, show]);
  return null;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <WithSync>
          <ToastProvider>
            <InvitationNotice />
            <EspaceProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
            </EspaceProvider>
          </ToastProvider>
        </WithSync>
      </AuthProvider>
    </ErrorBoundary>
  );
}
