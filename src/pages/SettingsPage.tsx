import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  User, Globe, Lock, Check, AlertCircle, SlidersHorizontal, Tag, Plus, Trash2, Layers, RotateCcw, Pencil, X,
  HardDrive, Cloud, Download, Upload, Link2, Unlink, FolderInput, UserPlus, Eraser, type LucideIcon,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useSync, useDataVersion } from "@/lib/sync";
import {
  db, dirtyFlag, exportAllData, importBackup, notifyDataChanged, removeDirty, copyLocalModeDataInto,
  localDatabaseHasData, deleteLocalDatabase, LOCAL_DB_NAME, userDbName,
} from "@/lib/db";
import { driveConfigured, driveConnected, connectDrive, disconnectDrive, uploadToDrive, downloadFromDrive, getDriveBackupInfo } from "@/lib/gdrive";
import { DRIVE_AUTO_KEY, DRIVE_LAST_KEY, isDriveAutoEnabled } from "@/lib/useDriveBackup";
import { t, type Lang, categoryLabel } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { DEFAULT_THRESHOLD, type Category } from "@/lib/useTransactions";
import { PasswordInput, StrengthMeter } from "@/components/PasswordFields";

function Section({ icon: Icon, color, title, hint, children }: { icon: LucideIcon; color: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="card p-6">
      <div className="mb-4 flex items-center gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
          <Icon size={18} />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white">{title}</h2>
          {hint && <p className="text-xs text-slate-500">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

export function SettingsPage() {
  const { profile, lang, mode, updateOwnProfile, updatePassword } = useAuth();
  const { espaces, currentEspace, role, createEspace, deleteEspace, resetEspace, renameEspace } = useEspace();
  const { state: syncState, sync } = useSync();
  const version = useDataVersion();
  const isAdmin = role === "admin";

  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };
  const busyWrap = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      flash("err", err instanceof Error ? err.message : t(lang, "error"));
    }
  };

  // ---- Profil / langue -------------------------------------------------------
  const [nom, setNom] = useState(profile?.nom ?? "");
  const [selLang, setSelLang] = useState<Lang>(lang);
  useEffect(() => setNom(profile?.nom ?? ""), [profile?.nom]);

  const saveProfile = () =>
    busyWrap(async () => {
      const { error } = await updateOwnProfile({ nom, langue: selLang });
      if (error) throw new Error(error);
      flash("ok", t(lang, "saved"));
    });

  // ---- Mot de passe ----------------------------------------------------------
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [savingPwd, setSavingPwd] = useState(false);
  const savePassword = () =>
    busyWrap(async () => {
      setSavingPwd(true);
      try {
        const { error } = await updatePassword(newPwd, currentPwd);
        if (error) throw new Error(error);
        setCurrentPwd("");
        setNewPwd("");
        flash("ok", t(lang, "passwordUpdated"));
      } finally {
        setSavingPwd(false);
      }
    });

  // ---- Seuil de validation (par espace) -------------------------------------
  const [threshold, setThreshold] = useState("");
  useEffect(() => {
    if (!currentEspace) return;
    db.settings.where("[espace_id+cle]").equals([currentEspace.id, "seuil_validation"]).first().then((s) => setThreshold(s?.valeur ?? String(DEFAULT_THRESHOLD)));
  }, [currentEspace, version]);

  const writeThreshold = async (n: number) => {
    if (!currentEspace) return;
    const existing = await db.settings.where("[espace_id+cle]").equals([currentEspace.id, "seuil_validation"]).first();
    if (existing?.id) await db.settings.update(existing.id, { valeur: String(n), dirty: dirtyFlag() });
    else await db.settings.add({ cle: "seuil_validation", valeur: String(n), espace_id: currentEspace.id, dirty: dirtyFlag() });
    notifyDataChanged();
  };

  // Seuil 0 = toute saisie d'un non-admin passe par la validation.
  const validateAll = threshold === "0";
  const toggleValidateAll = () =>
    busyWrap(async () => {
      const next = validateAll ? DEFAULT_THRESHOLD : 0;
      await writeThreshold(next);
      setThreshold(String(next));
      flash("ok", t(lang, "saved"));
    });

  const saveThreshold = () =>
    busyWrap(async () => {
      if (!currentEspace) return;
      const n = Number(threshold);
      if (!Number.isFinite(n) || n <= 0) throw new Error(t(lang, "fillAllFields"));
      await writeThreshold(n);
      flash("ok", t(lang, "saved"));
    });

  // ---- Catégories ------------------------------------------------------------
  const [categories, setCategories] = useState<Category[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#10b981");
  const loadCategories = useCallback(async () => {
    const rows = await db.categories.orderBy("ordre").toArray();
    setCategories(rows.filter((c) => !c.deleted).map((c) => ({ id: c.id!, nom: c.nom, couleur: c.couleur, icone: c.icone, ordre: c.ordre, active: c.active, user_id: c.cloud_id ? (c.user_id ?? null) : profile?.id })));
  }, [profile?.id]);
  useEffect(() => {
    loadCategories();
  }, [loadCategories, version]);

  const addCategory = () =>
    busyWrap(async () => {
      const name = newCatName.trim().slice(0, 40);
      if (!name) return;
      if (categories.some((c) => c.nom.toLowerCase() === name.toLowerCase())) throw new Error(t(lang, "categoryExists"));
      const maxOrder = Math.max(0, ...categories.map((c) => c.ordre));
      await db.categories.add({ nom: name, couleur: newCatColor, icone: "Tag", ordre: maxOrder + 1, active: true, dirty: dirtyFlag(), user_id: profile?.id });
      notifyDataChanged();
      setNewCatName("");
      flash("ok", t(lang, "saved"));
    });

  const deleteCategory = (cat: Category) =>
    busyWrap(async () => {
      if (!window.confirm(t(lang, "confirmDeleteCategory"))) return;
      await removeDirty("categories", cat.id);
      flash("ok", t(lang, "saved"));
    });

  // ---- Espaces ---------------------------------------------------------------
  const [newEspaceName, setNewEspaceName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const run = (p: Promise<{ error: string | null }>, okKey: string) =>
    busyWrap(async () => {
      const { error } = await p;
      if (error) throw new Error(error);
      flash("ok", t(lang, okKey));
    });

  // ---- Sauvegardes -----------------------------------------------------------
  const fileRef = useRef<HTMLInputElement>(null);
  const [driveOn, setDriveOn] = useState(driveConnected());
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveInfo, setDriveInfo] = useState<string | null>(localStorage.getItem(DRIVE_LAST_KEY));
  const [driveAuto, setDriveAuto] = useState(isDriveAutoEnabled());
  const [hasLocalModeData, setHasLocalModeData] = useState(false);

  useEffect(() => {
    if (mode === "cloud") localDatabaseHasData(LOCAL_DB_NAME).then(setHasLocalModeData).catch(() => setHasLocalModeData(false));
  }, [mode, version]);

  useEffect(() => {
    const onSaved = () => setDriveInfo(localStorage.getItem(DRIVE_LAST_KEY));
    window.addEventListener("mtantana:drive-saved", onSaved);
    return () => window.removeEventListener("mtantana:drive-saved", onSaved);
  }, []);

  const restore = async (json: string) => {
    if (!profile) return;
    if (mode === "local") {
      if (!window.confirm(t(lang, "confirmRestoreReplace"))) return;
      const res = await importBackup(json, { strategy: "replace", userId: profile.id });
      flash("ok", t(lang, "restoreDone", { n: res.transactions }));
      window.location.reload();
      return;
    }
    if (!currentEspace) return;
    if (!window.confirm(t(lang, "confirmRestoreMerge", { espace: currentEspace.nom }))) return;
    const res = await importBackup(json, { strategy: "merge", targetEspaceId: currentEspace.id, userId: profile.id });
    flash("ok", t(lang, "restoreDone", { n: res.transactions }));
  };

  const downloadFile = () =>
    busyWrap(async () => {
      const json = await exportAllData();
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `mtantana-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      flash("ok", t(lang, "backupSaved"));
    });

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) =>
    busyWrap(async () => {
      const file = e.target.files?.[0];
      if (fileRef.current) fileRef.current.value = "";
      if (!file) return;
      if (file.size > 50 * 1024 * 1024) throw new Error("Fichier trop volumineux (50 Mo max)");
      await restore(await file.text());
    });

  const driveAction = (fn: () => Promise<void>) =>
    busyWrap(async () => {
      setDriveBusy(true);
      try {
        await fn();
      } finally {
        setDriveBusy(false);
        setDriveOn(driveConnected());
      }
    });

  const handleConnectDrive = () =>
    driveAction(async () => {
      await connectDrive();
      const info = await getDriveBackupInfo();
      setDriveInfo(info?.modifiedTime ?? null);
      if (info) localStorage.setItem(DRIVE_LAST_KEY, info.modifiedTime);
    });

  const handleSaveDrive = () =>
    driveAction(async () => {
      if (!driveConnected()) await connectDrive();
      const at = await uploadToDrive(await exportAllData());
      localStorage.setItem(DRIVE_LAST_KEY, at);
      setDriveInfo(at);
      flash("ok", t(lang, "backupSaved"));
    });

  const handleRestoreDrive = () =>
    driveAction(async () => {
      if (!driveConnected()) await connectDrive();
      const json = await downloadFromDrive();
      if (!json) throw new Error(t(lang, "noDriveBackup"));
      await restore(json);
    });

  const toggleAuto = (v: boolean) => {
    setDriveAuto(v);
    localStorage.setItem(DRIVE_AUTO_KEY, v ? "1" : "0");
  };

  const importLocal = () =>
    busyWrap(async () => {
      if (!currentEspace || !profile) return;
      const res = await copyLocalModeDataInto(currentEspace.id, profile.id);
      flash("ok", t(lang, "restoreDone", { n: res.transactions }));
      sync();
    });

  const clearDevice = () =>
    busyWrap(async () => {
      if (!profile || !window.confirm(t(lang, "confirmClearDevice"))) return;
      if (mode === "cloud" && syncState.pending > 0 && !window.confirm(t(lang, "unsyncedWarning", { n: syncState.pending }))) return;
      await deleteLocalDatabase(mode === "local" ? LOCAL_DB_NAME : userDbName(profile.id));
      window.location.reload();
    });

  return (
    <Layout title={t(lang, "settings")} subtitle={profile?.nom}>
      <div className="mx-auto max-w-2xl space-y-5">
        {msg && (
          <div role={msg.type === "err" ? "alert" : "status"} className={`sticky top-0 z-10 flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm backdrop-blur ${msg.type === "ok" ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-300" : "border-rose-500/30 bg-rose-500/15 text-rose-300"}`}>
            {msg.type === "ok" ? <Check size={16} /> : <AlertCircle size={16} />}
            {msg.text}
          </div>
        )}

        {/* Profil + langue */}
        <Section icon={User} color="bg-emerald-500/15 text-emerald-400" title={t(lang, "profile")} hint={t(lang, "changeName")}>
          <div className="space-y-3">
            <div>
              <label htmlFor="s-nom" className="input-label">{t(lang, "nom")}</label>
              <input id="s-nom" type="text" value={nom} maxLength={100} onChange={(e) => setNom(e.target.value)} className="input" />
            </div>
            {mode === "cloud" && (
              <div>
                <label htmlFor="s-email" className="input-label">{t(lang, "email")}</label>
                <input id="s-email" type="email" value={profile?.email ?? ""} disabled className="input opacity-60" />
              </div>
            )}
            <div>
              <span className="input-label flex items-center gap-1.5"><Globe size={12} />{t(lang, "language")}</span>
              <div className="flex gap-2">
                {(["fr", "mg"] as Lang[]).map((l) => (
                  <button key={l} type="button" onClick={() => setSelLang(l)} aria-pressed={selLang === l} className={`flex-1 rounded-xl border px-4 py-2.5 text-sm font-semibold transition ${selLang === l ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"}`}>
                    {l === "fr" ? t(lang, "french") : t(lang, "malagasy")}
                  </button>
                ))}
              </div>
            </div>
            <button onClick={saveProfile} className="btn-primary">{t(lang, "update")}</button>
          </div>
        </Section>

        {/* Stockage et sauvegarde */}
        <Section icon={mode === "local" ? HardDrive : Cloud} color="bg-cyan-500/15 text-cyan-400" title={t(lang, "storage")} hint={mode === "local" ? t(lang, "localMode") : t(lang, "cloudMode")}>
          <p className="mb-4 text-sm text-slate-400">{mode === "local" ? t(lang, "storageHintLocal") : t(lang, "storageHintCloud")}</p>

          {mode === "local" && (
            <Link to="/signup" className="mb-4 flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 transition hover:bg-emerald-500/15">
              <UserPlus size={18} className="mt-0.5 shrink-0 text-emerald-400" />
              <div>
                <div className="text-sm font-semibold text-emerald-300">{t(lang, "createAccountToSync")}</div>
                <div className="text-xs text-slate-400">{t(lang, "createAccountToSyncHint")}</div>
              </div>
            </Link>
          )}

          {mode === "cloud" && hasLocalModeData && (
            <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-amber-300"><FolderInput size={16} />{t(lang, "importLocalData")}</div>
              <p className="mt-1 text-xs text-slate-400">{t(lang, "importLocalDataHint")}</p>
              <button onClick={importLocal} disabled={!currentEspace} className="btn-secondary mt-2 !py-1.5 !text-xs">{t(lang, "importLocalDataBtn")} · {currentEspace?.nom}</button>
            </div>
          )}

          {/* Google Drive */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-white">{t(lang, "googleDrive")}</div>
              {driveConfigured && driveOn && (
                <button onClick={() => { disconnectDrive(); setDriveOn(false); }} className="btn-ghost !px-2 !py-1 !text-xs"><Unlink size={12} />{t(lang, "disconnect")}</button>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">{driveConfigured ? t(lang, "driveHint") : t(lang, "driveNotConfigured")}</p>
            {driveConfigured && (
              <>
                <p className="mt-2 text-xs text-slate-400">{driveInfo ? t(lang, "lastDriveBackup", { date: formatDateTime(driveInfo, lang) }) : t(lang, "noDriveBackup")}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!driveOn && (
                    <button onClick={handleConnectDrive} disabled={driveBusy || !syncState.online} className="btn-secondary !py-2 !text-xs"><Link2 size={14} />{t(lang, "connectDrive")}</button>
                  )}
                  <button onClick={handleSaveDrive} disabled={driveBusy || !syncState.online} className="btn-primary !py-2 !text-xs"><Upload size={14} />{t(lang, "saveToDrive")}</button>
                  <button onClick={handleRestoreDrive} disabled={driveBusy || !syncState.online} className="btn-secondary !py-2 !text-xs"><Download size={14} />{t(lang, "restoreFromDrive")}</button>
                </div>
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={driveAuto} onChange={(e) => toggleAuto(e.target.checked)} className="h-4 w-4 accent-emerald-500" />
                  {t(lang, "autoDriveBackup")}
                </label>
              </>
            )}
          </div>

          {/* Fichier */}
          <div className="mt-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-sm font-semibold text-white">{t(lang, "fileBackup")}</div>
            <p className="mt-1 text-xs text-slate-500">{t(lang, "fileBackupHint")}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={downloadFile} className="btn-secondary !py-2 !text-xs"><Download size={14} />{t(lang, "downloadBackup")}</button>
              <button onClick={() => fileRef.current?.click()} className="btn-secondary !py-2 !text-xs"><Upload size={14} />{t(lang, "restoreFile")}</button>
              <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="hidden" />
            </div>
          </div>

          <button onClick={clearDevice} className="btn-ghost mt-4 !text-xs text-rose-300 hover:!text-rose-200"><Eraser size={14} />{t(lang, "clearDeviceData")}</button>
        </Section>

        {/* Mot de passe */}
        {mode === "cloud" && (
          <Section icon={Lock} color="bg-rose-500/15 text-rose-400" title={t(lang, "changePassword")}>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); savePassword(); }}>
              <input type="email" value={profile?.email ?? ""} autoComplete="username" readOnly hidden />
              <div>
                <label htmlFor="s-cur" className="input-label">{t(lang, "currentPassword")}</label>
                <PasswordInput id="s-cur" value={currentPwd} onChange={setCurrentPwd} lang={lang} autoComplete="current-password" />
              </div>
              <div>
                <label htmlFor="s-new" className="input-label">{t(lang, "newPassword")}</label>
                <PasswordInput id="s-new" value={newPwd} onChange={setNewPwd} lang={lang} autoComplete="new-password" />
                <StrengthMeter password={newPwd} lang={lang} />
              </div>
              <button type="submit" disabled={savingPwd || !syncState.online} className="btn-primary">{savingPwd ? t(lang, "loading") : t(lang, "update")}</button>
            </form>
          </Section>
        )}

        {/* Espaces */}
        <Section icon={Layers} color="bg-cyan-500/15 text-cyan-400" title={t(lang, "manageEspaces")} hint={t(lang, "createEspace")}>
          <form className="mb-4 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newEspaceName.trim()) run(createEspace(newEspaceName), "espaceCreated").then(() => setNewEspaceName("")); }}>
            <input type="text" value={newEspaceName} maxLength={100} onChange={(e) => setNewEspaceName(e.target.value)} className="input" placeholder={t(lang, "espaceName")} />
            <button type="submit" disabled={!newEspaceName.trim()} className="btn-primary shrink-0"><Plus size={16} /><span className="hidden sm:inline">{t(lang, "createEspace")}</span></button>
          </form>
          <div className="space-y-2">
            {espaces.map((e) => {
              const admin = e.role_dans_espace === "admin";
              return (
                <div key={e.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  {renamingId === e.id ? (
                    <form className="flex items-center gap-2" onSubmit={(ev) => { ev.preventDefault(); run(renameEspace(e.id, renameValue), "espaceRenamed").then(() => setRenamingId(null)); }}>
                      <input type="text" value={renameValue} maxLength={100} onChange={(ev) => setRenameValue(ev.target.value)} onKeyDown={(ev) => ev.key === "Escape" && setRenamingId(null)} className="input flex-1" autoFocus />
                      <button type="submit" className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400 hover:bg-emerald-500/25" aria-label={t(lang, "save")}><Check size={14} /></button>
                      <button type="button" onClick={() => setRenamingId(null)} className="rounded-lg bg-white/5 p-2 text-slate-400 hover:bg-white/10" aria-label={t(lang, "cancel")}><X size={14} /></button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Layers size={14} className="text-cyan-400" />
                      <span className="flex-1 truncate text-sm font-semibold text-white">{e.nom}</span>
                      <span className="text-[10px] uppercase text-slate-500">{t(lang, e.role_dans_espace === "operateur" ? "operator" : e.role_dans_espace)}</span>
                      {admin && (
                        <>
                          <button onClick={() => { setRenamingId(e.id); setRenameValue(e.nom); }} className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-500/10 hover:text-emerald-400" title={t(lang, "renameEspace")} aria-label={t(lang, "renameEspace")}><Pencil size={13} /></button>
                          <button onClick={() => window.confirm(t(lang, "confirmResetEspace")) && run(resetEspace(e.id), "espaceReset")} className="rounded-lg p-1.5 text-amber-400/70 hover:bg-amber-500/10 hover:text-amber-400" title={t(lang, "resetEspace")} aria-label={t(lang, "resetEspace")}><RotateCcw size={13} /></button>
                          {espaces.length > 1 && (
                            <button onClick={() => window.confirm(t(lang, "confirmDeleteEspace")) && run(deleteEspace(e.id), "espaceDeleted")} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400" title={t(lang, "deleteEspace")} aria-label={t(lang, "deleteEspace")}><Trash2 size={13} /></button>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* Seuil de validation */}
        {isAdmin && currentEspace && (
          <Section icon={SlidersHorizontal} color="bg-amber-500/15 text-amber-400" title={`${t(lang, "thresholdSetting")} · ${currentEspace.nom}`} hint={t(lang, "thresholdSettingHint")}>
            <label className="mb-4 flex cursor-pointer items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <input type="checkbox" checked={validateAll} onChange={toggleValidateAll} className="mt-1 h-4 w-4 accent-emerald-500" />
              <span>
                <span className="block text-sm font-semibold text-white">{t(lang, "validateAll")}</span>
                <span className="mt-0.5 block text-xs text-slate-400">{t(lang, "validateAllHint")}</span>
              </span>
            </label>
            {!validateAll && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); saveThreshold(); }}>
                <input type="number" inputMode="numeric" step="1000" min="1" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="input" placeholder="100000" aria-label={t(lang, "thresholdSetting")} />
                <button type="submit" className="btn-primary shrink-0">{t(lang, "update")}</button>
              </form>
            )}
          </Section>
        )}

        {/* Catégories */}
        <Section icon={Tag} color="bg-violet-500/15 text-violet-400" title={t(lang, "manageCategories")} hint={t(lang, "customCategories")}>
          <form className="mb-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); addCategory(); }}>
            <div className="min-w-[160px] flex-1">
              <label htmlFor="c-name" className="input-label">{t(lang, "newCategoryName")}</label>
              <input id="c-name" type="text" value={newCatName} maxLength={40} onChange={(e) => setNewCatName(e.target.value)} className="input" placeholder={t(lang, "newCategoryName")} />
            </div>
            <div>
              <label htmlFor="c-color" className="input-label">{t(lang, "newCategoryColor")}</label>
              <input id="c-color" type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} className="h-[42px] w-[60px] cursor-pointer rounded-xl border border-white/10 bg-transparent" />
            </div>
            <button type="submit" disabled={!newCatName.trim()} className="btn-primary shrink-0"><Plus size={16} />{t(lang, "addCategoryBtn")}</button>
          </form>
          <div className="space-y-1.5">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                <span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: c.couleur }} />
                <span className="flex-1 text-sm text-slate-200">{categoryLabel(lang, c.nom)}</span>
                {(mode === "local" || c.user_id) && (
                  <button onClick={() => deleteCategory(c)} className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400" title={t(lang, "delete")} aria-label={t(lang, "delete")}><Trash2 size={14} /></button>
                )}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </Layout>
  );
}
