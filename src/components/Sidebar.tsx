import { NavLink, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  ArrowRightLeft,
  ScrollText,
  Users,
  Settings as SettingsIcon,
  LogOut,
  Wifi,
  RefreshCw,
  Globe,
  PlusCircle,
  Wallet,
  Target,
  Repeat,
  Bell,
  Upload,
  Building2,
  ChevronDown,
  Download,
  Check,
  Plus,
  CheckCircle2,
  Trash2,
  RotateCcw,
  Pencil,
  Save,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useSync } from "@/lib/sync";
import { useEspace } from "@/lib/espace";
import { db, exportAllData, importAllData } from "@/lib/db";
import { t, type Lang } from "@/lib/i18n";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/components/Toast";

interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  roles: ("operateur" | "admin" | "superviseur")[];
}

const navItems: NavItem[] = [
  { to: "/saisie", labelKey: "saisie", icon: PlusCircle, roles: ["operateur", "admin", "superviseur"] },
  { to: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard, roles: ["admin", "superviseur"] },
  { to: "/transactions", labelKey: "transactions", icon: ArrowRightLeft, roles: ["admin", "superviseur"] },
  { to: "/import", labelKey: "importExcel", icon: Upload, roles: ["admin"] },
  { to: "/budgets", labelKey: "budgets", icon: Target, roles: ["admin", "superviseur"] },
  { to: "/recurring", labelKey: "recurring", icon: Repeat, roles: ["operateur", "admin", "superviseur"] },
  { to: "/alerts", labelKey: "alerts", icon: Bell, roles: ["admin"] },
  { to: "/audit", labelKey: "auditLog", icon: ScrollText, roles: ["admin"] },
  { to: "/users", labelKey: "users", icon: Users, roles: ["admin"] },
  { to: "/settings", labelKey: "settings", icon: SettingsIcon, roles: ["operateur", "admin", "superviseur"] },
];

interface EspaceOperator {
  id: string;
  nom: string;
  email: string;
  role_dans_espace: string;
}

export function Sidebar() {
  const { profile, lang, setLang, signOut } = useAuth();
  const navigate = useNavigate();
  const { state, sync } = useSync(profile?.id);
  const { espaces, currentEspace, setCurrentEspace, createEspace, deleteEspace, resetEspace, renameEspace, refresh: refreshEspaces } = useEspace();
  const [langOpen, setLangOpen] = useState(false);
  const [espaceMenuOpen, setEspaceMenuOpen] = useState(false);
  const [showCreateEspace, setShowCreateEspace] = useState(false);
  const [newEspaceName, setNewEspaceName] = useState("");
  const [creatingEspace, setCreatingEspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [operators, setOperators] = useState<EspaceOperator[]>([]);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { show: showToast } = useToast();

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    const installedHandler = () => {
      setInstalled(true);
      setInstallPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(null);
  };

  const role = profile?.role ?? "operateur";
  const isAdmin = role === "admin";
  const items = navItems.filter((i) => i.roles.includes(role));

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangOpen(false);
  };

  const loadOperators = useCallback(async (espaceId: string) => {
    const userEspaces = await db.user_espaces.where("espace_id").equals(espaceId).toArray();
    const userIds = userEspaces.map((ue) => ue.user_id);
    const users = await db.users.where("id").anyOf(userIds).toArray();
    const ops: EspaceOperator[] = users.map((u) => ({
      id: u.id,
      nom: u.nom,
      email: u.email,
      role_dans_espace: userEspaces.find((ue) => ue.user_id === u.id)?.role_dans_espace ?? "operateur",
    }));
    setOperators(ops);
  }, []);

  useEffect(() => {
    if (espaceMenuOpen && currentEspace) {
      loadOperators(currentEspace.id);
    }
  }, [espaceMenuOpen, currentEspace?.id, loadOperators]);

  const handleCreateEspace = async () => {
    if (!profile || !newEspaceName.trim()) return;
    setCreatingEspace(true);
    setCreateError(null);
    const { error } = await createEspace(newEspaceName.trim());
    if (error) {
      setCreateError(error);
      setCreatingEspace(false);
      return;
    }
    setNewEspaceName("");
    setShowCreateEspace(false);
    showToast(t(lang, "espaceCreated"), "success");
    refreshEspaces();
    setCreatingEspace(false);
  };

  const handleDeleteEspace = async (espaceId: string) => {
    if (!window.confirm(t(lang, "confirmDeleteEspace"))) return;
    const { error } = await deleteEspace(espaceId);
    if (error) {
      showToast(error, "error");
      return;
    }
    showToast(t(lang, "espaceDeleted"), "success");
    await refreshEspaces();
    setEspaceMenuOpen(false);
  };

  const handleStartRename = (e: typeof espaces[number]) => {
    setRenamingId(e.id);
    setRenameValue(e.nom);
  };

  const handleConfirmRename = async () => {
    if (!renamingId || !renameValue.trim()) return;
    const { error } = await renameEspace(renamingId, renameValue.trim());
    if (error) {
      showToast(error, "error");
    } else {
      showToast(t(lang, "espaceRenamed"), "success");
    }
    setRenamingId(null);
    setRenameValue("");
  };

  const handleResetEspace = async (espaceId: string) => {
    if (!window.confirm(t(lang, "confirmResetEspace"))) return;
    const { error } = await resetEspace(espaceId);
    if (error) {
      showToast(error, "error");
      return;
    }
    showToast(t(lang, "espaceReset"), "success");
    window.dispatchEvent(new CustomEvent("mtantana:reload-transactions"));
  };

  const handleSwitchEspace = (e: typeof espaces[number]) => {
    setCurrentEspace(e);
    setEspaceMenuOpen(false);
  };

  const handleSaveToFile = async () => {
    try {
      const defaultName = `mtantana-sauvegarde-${new Date().toISOString().slice(0, 10)}`;
      const inputName = window.prompt(t(lang, "saveFileNamePrompt"), defaultName);
      if (inputName === null) return;
      const fileName = inputName.trim() || defaultName;
      const json = await exportAllData();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.endsWith(".json") ? fileName : `${fileName}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast(t(lang, "saveSuccess"), "success");
    } catch (err) {
      showToast("Erreur lors de la sauvegarde", "error");
    }
  };

  const handleOpenFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await importAllData(text, true);
      showToast("Fichier chargé avec succès", "success");
      window.dispatchEvent(new CustomEvent("mtantana:reload-transactions"));
      await refreshEspaces();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Impossible d'ouvrir ce fichier";
      showToast(message, "error");
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const roleBadge = () => {
    if (role === "admin") return <span className="badge-admin !px-2 !py-0.5 !text-[10px]">{t(lang, "admin")}</span>;
    if (role === "superviseur") return <span className="badge-synced !px-2 !py-0.5 !text-[10px]">{t(lang, "superviseur")}</span>;
    return <span className="badge-operator !px-2 !py-0.5 !text-[10px]">{t(lang, "operator")}</span>;
  };

  return (
    <aside className="flex h-full w-64 flex-col border-r border-white/10 bg-[#0a101d]/80 backdrop-blur-xl">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-lg shadow-emerald-500/30">
          <Wallet size={20} className="text-emerald-950" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold text-white">M'tantana</div>
          <div className="text-[11px] text-slate-500">{t(lang, "appTagline")}</div>
        </div>
      </div>

      {/* Active Espace */}
      <div className="relative px-3 pt-1">
        <button
          onClick={() => setEspaceMenuOpen((v) => !v)}
          className="group flex w-full items-center gap-2.5 rounded-xl border border-emerald-500/20 bg-gradient-to-r from-emerald-500/10 to-cyan-500/5 px-3 py-2.5 text-left transition hover:border-emerald-500/40 hover:from-emerald-500/15"
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
            <div className="px-3 py-2">
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t(lang, "espaces")}</div>
              <div className="space-y-0.5">
                {espaces.map((e) => (
                  <div key={e.id} className="space-y-0.5">
                    {renamingId === e.id ? (
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
                        <input
                          type="text"
                          value={renameValue}
                          onChange={(ev) => setRenameValue(ev.target.value)}
                          onKeyDown={(ev) => { if (ev.key === "Enter") handleConfirmRename(); if (ev.key === "Escape") { setRenamingId(null); setRenameValue(""); } }}
                          className="w-full rounded-lg border border-emerald-500/40 bg-white/5 px-2 py-1 text-xs text-white focus:outline-none"
                          autoFocus
                        />
                        <button onClick={handleConfirmRename} className="rounded p-1 text-emerald-400 hover:bg-emerald-500/10" title={t(lang, "save")}>
                          <Check size={13} />
                        </button>
                        <button onClick={() => { setRenamingId(null); setRenameValue(""); }} className="rounded p-1 text-slate-400 hover:bg-white/10" title={t(lang, "cancel")}>
                          <span className="text-xs">✕</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleSwitchEspace(e)}
                        className={`group/esp flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition hover:bg-white/5 ${currentEspace?.id === e.id ? "bg-emerald-500/10 text-emerald-300" : "text-slate-300"}`}
                      >
                        <Building2 size={13} className="shrink-0" />
                        <span className="flex-1 truncate text-left">{e.nom}</span>
                        {currentEspace?.id === e.id && <CheckCircle2 size={13} className="shrink-0 text-emerald-400" />}
                        {isAdmin && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); handleStartRename(e); }}
                            className="ml-auto rounded p-0.5 text-slate-500 opacity-0 transition hover:text-emerald-400 group-hover/esp:opacity-100"
                            title={t(lang, "renameEspace")}
                          >
                            <Pencil size={12} />
                          </button>
                        )}
                        {isAdmin && espaces.length > 1 && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); handleDeleteEspace(e.id); }}
                            className="rounded p-0.5 text-slate-500 opacity-0 transition hover:text-rose-400 group-hover/esp:opacity-100"
                            title={t(lang, "deleteEspace")}
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {currentEspace && (
              <div className="border-t border-white/10 px-3 py-2">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t(lang, "operatorsInEspace")}</div>
                  {isAdmin && (
                    <button
                      onClick={() => handleResetEspace(currentEspace.id)}
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-medium text-amber-400/70 transition hover:bg-amber-500/10 hover:text-amber-400"
                      title={t(lang, "resetEspace")}
                    >
                      <RotateCcw size={10} />
                      {t(lang, "resetEspace")}
                    </button>
                  )}
                </div>
                <div className="space-y-1">
                  {operators.length === 0 ? (
                    <div className="px-2 py-1.5 text-[11px] text-slate-600">{t(lang, "noOperatorsInEspace")}</div>
                  ) : (
                    operators.map((op) => (
                      <div key={op.id} className="flex items-center gap-2 px-2 py-1 text-[11px]">
                        <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 text-[9px] font-bold text-emerald-300">
                          {op.nom.charAt(0).toUpperCase()}
                        </div>
                        <span className="flex-1 truncate text-slate-300">{op.nom}</span>
                        <span className="text-[9px] text-slate-600">{op.role_dans_espace}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="border-t border-white/10 p-2">
                {!showCreateEspace ? (
                  <button
                    onClick={() => setShowCreateEspace(true)}
                    className="flex w-full items-center gap-2 rounded-lg bg-emerald-500/10 px-2.5 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/20"
                  >
                    <Plus size={14} />
                    {t(lang, "createEspace")}
                  </button>
                ) : (
                  <div className="space-y-2 p-1">
                    <input
                      type="text"
                      value={newEspaceName}
                      onChange={(e) => setNewEspaceName(e.target.value)}
                      placeholder={t(lang, "espaceName")}
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:border-emerald-500/50 focus:outline-none"
                      autoFocus
                    />
                    {createError && <div className="text-[10px] text-rose-400">{createError}</div>}
                    <div className="flex gap-1.5">
                      <button
                        onClick={handleCreateEspace}
                        disabled={creatingEspace || !newEspaceName.trim()}
                        className="flex-1 rounded-lg bg-emerald-500/20 px-2 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/30 disabled:opacity-50"
                      >
                        {creatingEspace ? "..." : t(lang, "save")}
                      </button>
                      <button
                        onClick={() => { setShowCreateEspace(false); setNewEspaceName(""); }}
                        className="rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-medium text-slate-400 transition hover:bg-white/10"
                      >
                        {t(lang, "cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-item ${isActive ? "nav-item-active" : ""}`}
          >
            <item.icon size={18} />
            <span>{t(lang, item.labelKey)}</span>
          </NavLink>
        ))}
      </nav>

      {/* File save/open */}
      <div className="px-3 py-2">
        <div className="card px-3 py-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wifi size={15} className="text-emerald-400" />
              <span className="text-xs font-medium text-slate-300">{t(lang, "online")}</span>
            </div>
            <button
              onClick={() => sync()}
              className="flex items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[11px] font-semibold text-slate-300 transition hover:bg-white/10"
            >
              <RefreshCw size={12} />
              {t(lang, "syncNow")}
            </button>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleSaveToFile}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
            >
              <Save size={12} />
              {t(lang, "saveToFile")}
            </button>
            <button
              onClick={handleOpenFile}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-cyan-500/15 px-2 py-1.5 text-[11px] font-semibold text-cyan-300 transition hover:bg-cyan-500/25"
            >
              <FolderOpen size={12} />
              {t(lang, "openFile")}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileSelected}
            className="hidden"
          />
          {installPrompt && (
            <button
              onClick={handleInstall}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-500/15 px-2 py-1.5 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
            >
              <Download size={12} />
              {t(lang, "installApp")}
            </button>
          )}
          {installed && (
            <div className="flex items-center justify-center gap-1.5 rounded-lg bg-emerald-500/10 px-2 py-1.5 text-[11px] font-semibold text-emerald-400">
              <Check size={12} />
              {t(lang, "appInstalled")}
            </div>
          )}
        </div>
      </div>

      <div className="relative px-3 pb-2">
        <button
          onClick={() => setLangOpen((v) => !v)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10"
        >
          <span className="flex items-center gap-2">
            <Globe size={14} />
            {lang === "fr" ? t(lang, "french") : t(lang, "malagasy")}
          </span>
        </button>
        {langOpen && (
          <div className="absolute bottom-full left-3 right-3 mb-1 overflow-hidden rounded-xl border border-white/10 bg-[#0e1626] shadow-xl">
            {(["fr", "mg"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => switchLang(l)}
                className={`flex w-full items-center px-3 py-2 text-xs font-medium transition hover:bg-white/5 ${lang === l ? "text-emerald-300" : "text-slate-300"}`}
              >
                {l === "fr" ? t(lang, "french") : t(lang, "malagasy")}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-3 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-sm font-bold text-white">
            {profile?.nom?.charAt(0).toUpperCase() ?? "?"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{profile?.nom}</div>
            <div className="mt-0.5">{roleBadge()}</div>
          </div>
          <button
            onClick={handleSignOut}
            className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400"
            title={t(lang, "logout")}
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  );
}
