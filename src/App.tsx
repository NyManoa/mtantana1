import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, type ReactNode } from "react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { EspaceGuard } from "@/components/EspaceGuard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { EspaceProvider } from "@/lib/espace";
import { ToastProvider } from "@/components/Toast";
import { useSync } from "@/lib/sync";
import { AuthPage } from "@/pages/AuthPage";
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
import type { UserRole } from "@/lib/auth";

type RoleLevel = "operateur" | "superviseur" | "admin";

const roleRank: Record<RoleLevel, number> = { operateur: 0, superviseur: 1, admin: 2 };

function ProtectedRoute({
  children,
  minRole,
}: {
  children: ReactNode;
  minRole?: RoleLevel;
}) {
  const { session, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b1220] text-slate-500">
        <div className="h-8 w-8 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 spin-slow" />
      </div>
    );
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (minRole && profile) {
    const userRank = roleRank[profile.role as RoleLevel] ?? 0;
    const requiredRank = roleRank[minRole];
    if (userRank < requiredRank) {
      return <Navigate to="/saisie" replace />;
    }
  }

  return <EspaceGuard>{children}</EspaceGuard>;
}

function AppRoutes() {
  const { session, profile, loading } = useAuth();
  const { sync } = useSync(profile?.id);

  useEffect(() => {
    if (session && profile) {
      sync();
    }
  }, [session, profile, sync]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b1220] text-slate-500">
        <div className="h-8 w-8 rounded-full border-2 border-emerald-500/30 border-t-emerald-400 spin-slow" />
      </div>
    );
  }

  // After login, operators go to /saisie, admins/superviseurs go to /dashboard
  const homeRoute = profile?.role === "operateur" ? "/saisie" : "/dashboard";

  return (
    <Routes>
      <Route path="/login" element={session ? <Navigate to={homeRoute} replace /> : <AuthPage mode="login" />} />
      <Route path="/signup" element={session ? <Navigate to={homeRoute} replace /> : <AuthPage mode="signup" />} />

      <Route path="/saisie" element={<ProtectedRoute><SaisiePage /></ProtectedRoute>} />

      <Route path="/dashboard" element={<ProtectedRoute minRole="superviseur"><DashboardPage /></ProtectedRoute>} />
      <Route path="/transactions" element={<ProtectedRoute minRole="superviseur"><TransactionsPage /></ProtectedRoute>} />
      <Route path="/budgets" element={<ProtectedRoute minRole="superviseur"><BudgetsPage /></ProtectedRoute>} />
      <Route path="/recurring" element={<ProtectedRoute><RecurringPage /></ProtectedRoute>} />
      <Route path="/alerts" element={<ProtectedRoute minRole="admin"><AlertsPage /></ProtectedRoute>} />
      <Route path="/import" element={<ProtectedRoute minRole="admin"><ImportPage /></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute minRole="admin"><AuditPage /></ProtectedRoute>} />
      <Route path="/users" element={<ProtectedRoute minRole="admin"><UsersPage /></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to={session ? homeRoute : "/login"} replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <EspaceProvider>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </EspaceProvider>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
