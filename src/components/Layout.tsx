import { type ReactNode, useEffect, useState } from "react";
import { Menu, X, WifiOff, Bell } from "lucide-react";
import { Link } from "react-router-dom";
import { useInbox } from "@/lib/inbox";
import { Sidebar } from "./Sidebar";
import { Footer } from "./Footer";
import { useAuth } from "@/lib/auth";
import { useSync } from "@/lib/sync";
import { t } from "@/lib/i18n";

interface LayoutProps {
  children: ReactNode;
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  noFooter?: boolean;
}

export function Layout({ children, title, subtitle, actions, noFooter }: LayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { lang, mode, cloudStatus } = useAuth();
  const { state } = useSync();
  const { unread, taskCount } = useInbox();
  const badge = unread + taskCount;
  const cloudDown = mode === "cloud" && (!state.online || cloudStatus === "unreachable");
  const downLabel = !state.online ? t(lang, "offline") : t(lang, "serverDown");

  useEffect(() => {
    document.title = `${title} · M'tantana`;
  }, [title]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMobileOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-[#0b1220]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-emerald-500 focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-emerald-950">
        {t(lang, "skipToContent")}
      </a>

      <div className="hidden md:block">
        <Sidebar />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label={t(lang, "menu")}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full animate-fade-up">
            <div className="relative h-full">
              <Sidebar onNavigate={() => setMobileOpen(false)} />
              <button onClick={() => setMobileOpen(false)} className="absolute -right-11 top-3 rounded-lg bg-white/10 p-2 text-slate-300" aria-label={t(lang, "close")}>
                <X size={18} />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white md:hidden" aria-label={t(lang, "menu")}>
              <Menu size={20} />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold text-white sm:text-xl">{title}</h1>
              {subtitle && <p className="mt-0.5 truncate text-sm text-slate-400">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {cloudDown && (
              <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-300 sm:inline-flex">
                <WifiOff size={12} />
                {downLabel}
              </span>
            )}
            <Link
              to={taskCount > 0 ? "/ordres" : "/ordres?tab=activite"}
              className="relative rounded-lg p-2 text-slate-400 transition hover:bg-white/10 hover:text-white"
              aria-label={`${t(lang, "notifications")}${badge ? ` (${badge})` : ""}`}
              title={t(lang, "notifications")}
            >
              <Bell size={19} />
              {badge > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-bold text-slate-900">
                  {badge > 99 ? "99+" : badge}
                </span>
              )}
            </Link>
            {actions}
          </div>
        </header>
        {cloudDown && (
          <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-xs text-amber-300 sm:hidden">
            <WifiOff size={12} />
            {downLabel}
            {state.pending > 0 && ` · ${t(lang, "pendingCount", { n: state.pending })}`}
          </div>
        )}
        <div className="flex flex-1 flex-col overflow-y-auto">
          <main id="main" className="flex-1 px-4 py-6 sm:px-6">{children}</main>
          {!noFooter && <Footer />}
        </div>
      </div>
    </div>
  );
}
