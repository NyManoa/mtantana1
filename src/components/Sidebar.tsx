import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ArrowRightLeft,
  ScrollText,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Wifi,
  WifiOff,
  RefreshCw,
  Globe,
  PlusCircle,
  Wallet,
  Target,
  Repeat,
  Bell,
  Upload,
  Building2,
  ClipboardCheck,
  ChevronDown,
  Download,
  Plus,
  CheckCircle2,
  HardDrive,
  CloudOff,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSync } from "@/lib/sync";
import { useEspace } from "@/lib/espace";
import { t, type Lang } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import type { Role } from "@/lib/db";
import { useState, useEffect } from "react";
import { useToast } from "@/components/Toast";
import { useInbox } from "@/lib/inbox";

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: Role[];
  cloudOnly?: boolean;
  /** Pastille : nombre d'éléments à traiter */
  badge?: "tasks";
}

const ALL: Role[] = ["operateur", "admin", "superviseur"];
const navItems: NavItem[] = [
  { to: "/saisie", labelKey: "saisie", icon: PlusCircle, roles: ALL },
  { to: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, roles: ["admin", "superviseur"] },
  { to: "/transactions", labelKey: "transactions", icon: ArrowRightLeft, roles: ALL },
  { to: "/budgets", labelKey: "budgets", icon: Target, roles: ["admin", "superviseur"] },
  { to: "/ordres", labelKey: "orders", icon: ClipboardCheck, roles: ALL, badge: "tasks" },
  { to: "/recurring", labelKey: "recurring", icon: Repeat, roles: ALL },
  { to: "/import", labelKey: "importExcel", icon: Upload, roles: ["admin"] },
  { to: "/alerts", labelKey: "alerts", icon: Bell, roles: ["admin", "superviseur"] },
  { to: "/audit", labelKey: "auditLog", icon: ScrollText, roles: ["admin"] },
  { to: "/users", labelKey: "users", icon: Users, roles: ["admin"], cloudOnly: true },
  { to: "/settings", labelKey: "settings", icon: SettingsIcon, roles: ALL },
];

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<unknown>;
}

function SyncStatus({ lang }: { lang: Lang }) {
  const { mode } = useAuth();
  const { state, sync } = useSync();

  if (mode === "local") {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-300">
        <HardDrive size={15} className="text-cyan-400" />
        <span className="font-medium">{t(lang, "localOnly")}</span>
      </div>
    );
  }

  const icon = !state.online ? (
    <WifiOff size={15} className="text-amber-400" />
  ) : state.error ? (
    <AlertTriangle size={15} className="text-rose-400" />
  ) : state.pending > 0 ? (
    <CloudOff size={15} className="text-amber-400" />
  ) : (
    <Wifi size={15} className="text-emerald-400" />
  );

  const label = !state.online
    ? t(lang, "offline")
    : state.syncing
      ? t(lang, "syncInProgress")
      : state.error
        ? t(lang, "syncFailed")
        : state.pending > 0
          ? t(lang, "pendingCount", { n: state.pending })
          : t(lang, "allSynced");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2" aria-live="polite">
          {icon}
          <span className="truncate text-xs font-medium text-slate-300">{label}</span>
        </div>
        <button
          onClick={() => sync()}
          disabled={!state.online || state.syncing}
          className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
          title={t(lang, "syncNow")}
          aria-label={t(lang, "syncNow")}
        >
          <RefreshCw size={12} className={state.syncing ? "animate-spin" : ""} />
        </button>
      </div>
      {!state.online && state.pending > 0 && (
        <div className="text-[11px] text-amber-300/80">{t(lang, "pendingCount", { n: state.pending })}</div>
      )}
      {state.error && <div className="line-clamp-2 text-[11px] text-rose-300/80" title={state.error}>{state.error}</div>}
      <div className="text-[10px] text-slate-500">
        {state.lastSync ? t(lang, "lastSyncAt", { date: formatDateTime(state.lastSync, lang) }) : t(lang, "neverSynced")}
      </div>
    </div>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { profile, lang, setLang, signOut, mode } = useAuth();
  const navigate = useNavigate();
  const { state } = useSync();
  const { espaces, currentEspace, setCurrentEspace, createEspace, role, fonction } = useEspace();
  const { taskCount } = useInbox();
  const { show: showToast } = useToast();
  const [espaceMenuOpen, setEspaceMenuOpen] = useState(false);
  const [showCreateEspace, setShowCreateEspace] = useState(false);
  const [newEspaceName, setNewEspaceName] = useState("");
  const [creatingEspace, setCreatingEspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as InstallPromptEvent);
    };
    const installed = () => setInstallPrompt(null);
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);

  const items = navItems.filter((i) => i.roles.includes(role) && (!i.cloudOnly || mode === "cloud"));
  // Créer un espace est permis à tout utilisateur connecté (il en devient admin).
  const canCreateEspace = mode === "local" || state.online;

  const handleSignOut = async () => {
    if (mode === "cloud" && state.pending > 0 && !window.confirm(t(lang, "unsyncedWarning", { n: state.pending }))) return;
    await signOut();
    navigate("/login");
  };

  const handleCreateEspace = async () => {
    if (!newEspaceName.trim()) return;
    setCreatingEspace(true);
    setCreateError(null);
    const { error } = await createEspace(newEspaceName.trim());
    setCreatingEspace(false);
    if (error) {
      setCreateError(error);
      return;
    }
    setNewEspaceName("");
    setShowCreateEspace(false);
    setEspaceMenuOpen(false);
    showToast(t(lang, "espaceCreated"), "success");
  };

  const roleBadge =
    role === "admin" ? (
      <span className="badge-admin !px-2 !py-0.5 !text-[10px]">{t(lang, "admin")}</span>
    ) : role === "superviseur" ? (
      <span className="badge-synced !px-2 !py-0.5 !text-[10px]">{t(lang, "superviseur")}</span>
    ) : (
      <span className="badge-operator !px-2 !py-0.5 !text-[10px]">{t(lang, "operator")}</span>
    );

  return (
    <aside className="flex h-full w-64 flex-col border-r border-white/10 bg-[#0a101d]/95 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-lg shadow-emerald-500/30">
          <Wallet size={20} className="text-emerald-950" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold text-white">M'tantana</div>
          <div className="text-[11px] text-slate-500">{t(lang, "appTagline")}</div>
        </div>
      </div>

      {/* Espace courant */}
      <div className="relative px-3 pt-1">
        <button
          onClick={() => setEspaceMenuOpen((v) => !v)}
          aria-expanded={espaceMenuOpen}
          className="group flex w-full items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-cyan-500/5 px-3 py-2.5 text-left transition hover:border-emerald-500/40"
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400">
            <Building2 size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-medium uppercase tracking-wider text-emerald-400/70">{t(lang, "currentEspace")}</div>
            <div className="truncate text-sm font-bold text-white">{currentEspace?.nom ?? t(lang, "noEspaces")}</div>
          </div>
          <ChevronDown size={16} className={`shrink-0 text-slate-400 transition ${espaceMenuOpen ? "rotate-180" : ""}`} />
        </button>

        {espaceMenuOpen && (
          <div className="absolute left-3 right-3 top-full z-30 mt-1 overflow-hidden rounded-xl border border-white/10 bg-[#0e1626] shadow-2xl">
            <div className="max-h-64 space-y-0.5 overflow-y-auto p-2">
              {espaces.map((e) => (
                <button
                  key={e.id}
                  onClick={() => {
                    setCurrentEspace(e);
                    setEspaceMenuOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition hover:bg-white/5 ${currentEspace?.id === e.id ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300"}`}
                >
                  <Building2 size={13} className="shrink-0" />
                  <span className="flex-1 truncate text-left">{e.nom}</span>
                  <span className="text-[9px] uppercase text-slate-500">{t(lang, e.role_dans_espace === "operateur" ? "operator" : e.role_dans_espace)}</span>
                  {currentEspace?.id === e.id && <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />}
                </button>
              ))}
            </div>
            <div className="border-t border-white/10 p-2">
              {!showCreateEspace ? (
                <button
                  onClick={() => setShowCreateEspace(true)}
                  disabled={!canCreateEspace}
                  title={canCreateEspace ? undefined : t(lang, "onlineRequired")}
                  className="flex w-full items-center gap-2 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-40"
                >
                  <Plus size={14} />
                  {t(lang, "createEspace")}
                </button>
              ) : (
                <form
                  className="space-y-2 p-1"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleCreateEspace();
                  }}
                >
                  <input
                    type="text"
                    value={newEspaceName}
                    onChange={(e) => setNewEspaceName(e.target.value)}
                    placeholder={t(lang, "espaceName")}
                    maxLength={100}
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500/50 focus:outline-none"
                    autoFocus
                  />
                  {createError && <div className="text-[10px] text-rose-400">{createError}</div>}
                  <div className="flex gap-1.5">
                    <button type="submit" disabled={creatingEspace || !newEspaceName.trim()} className="flex-1 rounded-lg bg-emerald-500/20 px-2 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/30 disabled:opacity-50">
                      {creatingEspace ? "…" : t(lang, "save")}
                    </button>
                    <button type="button" onClick={() => { setShowCreateEspace(false); setNewEspaceName(""); }} className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-white/10">
                      {t(lang, "cancel")}
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3" aria-label="Navigation principale">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} onClick={onNavigate} className={({ isActive }) => `nav-item ${isActive ? "nav-item-active" : ""}`}>
            <item.icon size={18} />
            <span className="flex-1">{t(lang, item.labelKey)}</span>
            {item.badge === "tasks" && taskCount > 0 && (
              <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-slate-900" aria-label={t(lang, "tasksPending", { n: taskCount })}>
                {taskCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="space-y-2 px-3 py-2">
        <div className="card px-3 py-2.5">
          <SyncStatus lang={lang} />
        </div>
        {installPrompt && (
          <button
            onClick={async () => {
              await installPrompt.prompt();
              await installPrompt.userChoice;
              setInstallPrompt(null);
            }}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
          >
            <Download size={13} />
            {t(lang, "installApp")}
          </button>
        )}
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1" role="group" aria-label={t(lang, "language")}>
          <Globe size={14} className="ml-2 text-slate-500" />
          {(["fr", "mg"] as Lang[]).map((l) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${lang === l ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-white"}`}
            >
              {l === "fr" ? "Français" : "Malagasy"}
            </button>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-sm font-bold text-white">
            {profile?.nom?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{profile?.nom}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1">
              {roleBadge}
              {fonction && <span className="truncate text-[10px] font-medium text-slate-400">{fonction}</span>}
            </div>
            {mode === "local" && <div className="mt-0.5 truncate text-[10px] text-cyan-300/80">{t(lang, "localMode")}</div>}
          </div>
          <button onClick={handleSignOut} className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400" title={t(lang, "logout")} aria-label={t(lang, "logout")}>
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
