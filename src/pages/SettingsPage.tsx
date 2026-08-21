import { useState, useEffect, useCallback } from "react";
import { Settings as SettingsIcon, User, Globe, Lock, Check, AlertCircle, SlidersHorizontal, Tag, Plus, Trash2, Layers, RotateCcw, Pencil, X } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { db, genId } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { t, type Lang, categoryLabel } from "@/lib/i18n";
import type { Category } from "@/lib/useTransactions";

export function SettingsPage() {
  const { profile, lang, setLang, refreshProfile } = useAuth();
  const [nom, setNom] = useState(profile?.nom ?? "");
  const [selLang, setSelLang] = useState<Lang>(lang);
  const [newPassword, setNewPassword] = useState("");
  const [threshold, setThreshold] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingLang, setSavingLang] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [savingThreshold, setSavingThreshold] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [newCatName, setNewCatName] = useState("");
  const [newCatColor, setNewCatColor] = useState("#10b981");
  const [savingCat, setSavingCat] = useState(false);

  const { espaces, refresh: refreshEspaces, addEspaceOptimistic, createEspace, deleteEspace, resetEspace, renameEspace } = useEspace();
  const [newEspaceName, setNewEspaceName] = useState("");
  const [savingEspace, setSavingEspace] = useState(false);
  const [renamingEspaceId, setRenamingEspaceId] = useState<string | null>(null);
  const [renameEspaceValue, setRenameEspaceValue] = useState("");
  const [espaceOperators, setEspaceOperators] = useState<Record<string, { id: string; nom: string; email: string }[]>>({});

  const flash = (type: "ok" | "err", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3000);
  };

  const saveProfile = async () => {
    if (!profile) return;
    setSavingProfile(true);
    await db.users.update(profile.id, { nom });
    if (navigator.onLine) {
      await supabase.from("profiles").update({ nom }).eq("id", profile.id);
    }
    setSavingProfile(false);
    flash("ok", t(lang, "saved"));
    refreshProfile();
  };

  const saveLanguage = async () => {
    if (!profile) return;
    setSavingLang(true);
    await db.users.update(profile.id, { langue: selLang });
    if (navigator.onLine) {
      await supabase.from("profiles").update({ langue: selLang }).eq("id", profile.id);
    }
    setSavingLang(false);
    setLang(selLang);
    flash("ok", t(lang, "saved"));
    refreshProfile();
  };

  const savePassword = async () => {
    if (!profile) return;
    if (!newPassword || newPassword.length < 6) {
      flash("err", t(lang, "fillAllFields"));
      return;
    }
    setSavingPwd(true);
    await db.users.update(profile.id, { password: newPassword });
    if (navigator.onLine) {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        flash("err", error.message);
        setSavingPwd(false);
        return;
      }
    }
    setSavingPwd(false);
    setNewPassword("");
    flash("ok", t(lang, "saved"));
  };

  const saveThreshold = async () => {
    if (!profile) return;
    setSavingThreshold(true);
    const existing = await db.settings.where("cle").equals("seuil_validation").toArray();
    if (existing.length > 0 && existing[0].id) {
      await db.settings.update(existing[0].id, { valeur: threshold });
    } else {
      await db.settings.add({ cle: "seuil_validation", valeur: threshold, espace_id: "" });
    }
    if (navigator.onLine) {
      const { data: cloudExisting } = await supabase
        .from("settings")
        .select("cle")
        .eq("cle", "seuil_validation")
        .maybeSingle();
      if (cloudExisting) {
        await supabase.from("settings").update({ valeur: threshold }).eq("cle", "seuil_validation");
      } else {
        await supabase.from("settings").insert({ cle: "seuil_validation", valeur: threshold });
      }
    }
    setSavingThreshold(false);
    flash("ok", t(lang, "saved"));
  };

  const loadCategories = useCallback(async () => {
    const rows = await db.categories.orderBy("ordre").toArray();
    setCategories(rows.map(c => ({ ...c, id: c.id!, user_id: null })));
  }, []);

  const addCategory = async () => {
    if (!newCatName.trim()) return;
    const name = newCatName.trim();
    if (categories.some((c) => c.nom === name)) {
      flash("err", t(lang, "categoryExists"));
      return;
    }
    setSavingCat(true);
    const maxOrder = Math.max(...categories.map((c) => c.ordre), 100);
    const catId = genId();
    await db.categories.add({
      id: catId,
      nom: name,
      couleur: newCatColor,
      icone: "tag",
      ordre: maxOrder + 1,
      active: true,
    });
    if (navigator.onLine) {
      await supabase.from("categories").insert({
        id: catId,
        nom: name,
        couleur: newCatColor,
        icone: "tag",
        ordre: maxOrder + 1,
        active: true,
      });
    }
    setSavingCat(false);
    setNewCatName("");
    flash("ok", t(lang, "saved"));
    loadCategories();
  };

  const deleteCategory = async (cat: Category) => {
    if (!window.confirm(t(lang, "confirmDeleteCategory"))) return;
    await db.categories.delete(cat.id);
    if (navigator.onLine) {
      await supabase.from("categories").delete().eq("id", cat.id);
    }
    flash("ok", t(lang, "saved"));
    loadCategories();
  };

  useEffect(() => {
    if (profile) loadCategories();
  }, [profile?.id, loadCategories]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    (async () => {
      const setting = await db.settings.where("cle").equals("seuil_validation").toArray();
      if (setting[0]?.valeur) setThreshold(setting[0].valeur);
      else setThreshold("100000");
    })();
  }, [profile?.role]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    (async () => {
      const allUE = await db.user_espaces.toArray();
      const allUsers = await db.users.toArray();
      const map: Record<string, { id: string; nom: string; email: string }[]> = {};
      for (const ue of allUE) {
        const u = allUsers.find(x => x.id === ue.user_id);
        if (!u) continue;
        if (!map[ue.espace_id]) map[ue.espace_id] = [];
        map[ue.espace_id].push({ id: u.id, nom: u.nom, email: u.email });
      }
      setEspaceOperators(map);
    })();
  }, [profile?.role, espaces]);

  const handleRenameEspace = async (espaceId: string) => {
    if (!renameEspaceValue.trim()) return;
    const { error } = await renameEspace(espaceId, renameEspaceValue.trim());
    if (error) { flash("err", error); return; }
    flash("ok", t(lang, "espaceRenamed"));
    setRenamingEspaceId(null);
    setRenameEspaceValue("");
    refreshEspaces();
  };

  const handleCreateEspace = async () => {
    if (!newEspaceName.trim()) return;
    setSavingEspace(true);
    const { error } = await createEspace(newEspaceName.trim());
    setSavingEspace(false);
    if (error) { flash("err", error); return; }
    setNewEspaceName("");
    flash("ok", t(lang, "espaceCreated"));
    refreshEspaces();
  };

  const handleDeleteEspace = async (espaceId: string) => {
    if (!window.confirm(t(lang, "confirmDeleteEspace"))) return;
    const { error } = await deleteEspace(espaceId);
    if (error) { flash("err", error); return; }
    flash("ok", t(lang, "espaceDeleted"));
    refreshEspaces();
  };

  const handleResetEspace = async (espaceId: string) => {
    if (!window.confirm(t(lang, "confirmResetEspace"))) return;
    const { error } = await resetEspace(espaceId);
    if (error) { flash("err", error); return; }
    flash("ok", t(lang, "espaceReset"));
    window.dispatchEvent(new CustomEvent("mtantana:reload-transactions"));
  };

  return (
    <Layout title={t(lang, "settings")} subtitle={t(lang, "profile")}>
      <div className="mx-auto max-w-2xl space-y-5">
        {msg && (
          <div
            className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
              msg.type === "ok"
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-rose-500/30 bg-rose-500/10 text-rose-300"
            }`}
          >
            {msg.type === "ok" ? <Check size={16} /> : <AlertCircle size={16} />}
            {msg.text}
          </div>
        )}

        <div className="card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
              <User size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{t(lang, "profile")}</h2>
              <p className="text-xs text-slate-500">{t(lang, "changeName")}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="input-label">{t(lang, "nom")}</label>
              <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} className="input" />
            </div>
            <div>
              <label className="input-label">{t(lang, "email")}</label>
              <input type="email" value={profile?.email ?? ""} disabled className="input opacity-60" />
            </div>
            <button onClick={saveProfile} disabled={savingProfile} className="btn-primary">
              {savingProfile ? t(lang, "loading") : t(lang, "update")}
            </button>
          </div>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
              <Globe size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{t(lang, "language")}</h2>
              <p className="text-xs text-slate-500">{t(lang, "changeLanguage")}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {(["fr", "mg"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setSelLang(l)}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                  selLang === l
                    ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                    : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                {l === "fr" ? t(lang, "french") : t(lang, "malagasy")}
              </button>
            ))}
          </div>
          <button onClick={saveLanguage} disabled={savingLang} className="btn-primary mt-3">
            {savingLang ? t(lang, "loading") : t(lang, "update")}
          </button>
        </div>

        <div className="card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400">
              <Lock size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{t(lang, "changePassword")}</h2>
              <p className="text-xs text-slate-500">{t(lang, "newPassword")}</p>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="input-label">{t(lang, "newPassword")}</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="input"
                placeholder={t(lang, "newPassword")}
              />
            </div>
            <button onClick={savePassword} disabled={savingPwd} className="btn-primary">
              {savingPwd ? t(lang, "loading") : t(lang, "update")}
            </button>
          </div>
        </div>

        {profile?.role === "admin" && (
          <div className="card p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-400">
                <Layers size={18} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">{t(lang, "manageEspaces")}</h2>
                <p className="text-xs text-slate-500">{t(lang, "createEspace")}</p>
              </div>
            </div>
            <div className="mb-4 flex gap-2">
              <input type="text" value={newEspaceName} onChange={(e) => setNewEspaceName(e.target.value)} className="input" placeholder={t(lang, "espaceName")} />
              <button onClick={handleCreateEspace} disabled={savingEspace || !newEspaceName.trim()} className="btn-primary shrink-0">
                {savingEspace ? t(lang, "loading") : <><Plus size={16} />{t(lang, "createEspace")}</>}
              </button>
            </div>
            <div className="space-y-3">
              {espaces.map((e) => (
                <div key={e.id} className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                  {renamingEspaceId === e.id ? (
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="text"
                        value={renameEspaceValue}
                        onChange={(ev) => setRenameEspaceValue(ev.target.value)}
                        onKeyDown={(ev) => { if (ev.key === "Enter") handleRenameEspace(e.id); if (ev.key === "Escape") { setRenamingEspaceId(null); setRenameEspaceValue(""); } }}
                        className="input flex-1"
                        autoFocus
                      />
                      <button onClick={() => handleRenameEspace(e.id)} className="rounded-lg bg-emerald-500/15 p-2 text-emerald-400 transition hover:bg-emerald-500/25" title={t(lang, "save")}>
                        <Check size={14} />
                      </button>
                      <button onClick={() => { setRenamingEspaceId(null); setRenameEspaceValue(""); }} className="rounded-lg bg-white/5 p-2 text-slate-400 transition hover:bg-white/10" title={t(lang, "cancel")}>
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <Layers size={14} className="text-cyan-400" />
                      <span className="flex-1 text-sm font-semibold text-white">{e.nom}</span>
                      <span className="text-xs text-slate-500">{(espaceOperators[e.id] ?? []).length} {t(lang, "users")}</span>
                      <button onClick={() => { setRenamingEspaceId(e.id); setRenameEspaceValue(e.nom); }} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-500/10 hover:text-emerald-400" title={t(lang, "renameEspace")}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => handleResetEspace(e.id)} className="rounded-lg p-1.5 text-amber-400/70 transition hover:bg-amber-500/10 hover:text-amber-400" title={t(lang, "resetEspace")}>
                        <RotateCcw size={13} />
                      </button>
                      {espaces.length > 1 && (
                        <button onClick={() => handleDeleteEspace(e.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400" title={t(lang, "deleteEspace")}>
                          <Trash2 size={13} />
                        </button>
                      )}
                    </div>
                  )}
                  {(espaceOperators[e.id] ?? []).length > 0 && (
                    <div className="mt-2 space-y-1">
                      {(espaceOperators[e.id] ?? []).map((op) => (
                        <div key={op.id} className="flex items-center gap-2 text-xs text-slate-400">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold">{op.nom.charAt(0).toUpperCase()}</span>
                          <span className="flex-1">{op.nom}</span>
                          <span className="text-slate-600">{op.email}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-400">
              <Tag size={18} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">{t(lang, "manageCategories")}</h2>
              <p className="text-xs text-slate-500">{t(lang, "customCategories")}</p>
            </div>
          </div>

          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[160px]">
              <label className="input-label">{t(lang, "newCategoryName")}</label>
              <input type="text" value={newCatName} onChange={(e) => setNewCatName(e.target.value)} className="input" placeholder={t(lang, "newCategoryName")} />
            </div>
            <div>
              <label className="input-label">{t(lang, "newCategoryColor")}</label>
              <input type="color" value={newCatColor} onChange={(e) => setNewCatColor(e.target.value)} className="h-[42px] w-[60px] cursor-pointer rounded-xl border border-white/10 bg-transparent" />
            </div>
            <button onClick={addCategory} disabled={savingCat || !newCatName.trim()} className="btn-primary shrink-0">
              {savingCat ? t(lang, "loading") : <><Plus size={16} />{t(lang, "addCategoryBtn")}</>}
            </button>
          </div>

          <div className="space-y-1.5">
            {categories.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
                <span className="h-4 w-4 shrink-0 rounded-sm" style={{ backgroundColor: c.couleur }} />
                <span className="flex-1 text-sm text-slate-200">{categoryLabel(lang, c.nom)}</span>
                <button onClick={() => deleteCategory(c)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400" title={t(lang, "delete")}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {profile?.role === "admin" && (
          <div className="card p-6">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                <SlidersHorizontal size={18} />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">{t(lang, "thresholdSetting")}</h2>
                <p className="text-xs text-slate-500">{t(lang, "thresholdSettingHint")}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <input type="number" step="1000" min="0" value={threshold} onChange={(e) => setThreshold(e.target.value)} className="input" placeholder="100000" />
              <button onClick={saveThreshold} disabled={savingThreshold} className="btn-primary shrink-0">
                {savingThreshold ? t(lang, "loading") : t(lang, "update")}
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 px-1 text-xs text-slate-600">
          <SettingsIcon size={12} />
          M'tantana · Local + Cloud
        </div>
      </div>
    </Layout>
  );
}
