import { useCallback, useEffect, useState } from "react";
import { Bell, Plus, X, Trash2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { db, dirtyFlag, genId, notifyDataChanged, removeDirty, updateDirty } from "@/lib/db";
import { useDataVersion } from "@/lib/sync";
import { t } from "@/lib/i18n";
import { formatAriary, formatDateTime } from "@/lib/format";

interface Alert {
  id: number;
  type: "solde_bas" | "grosse_depense";
  seuil: number;
  active: boolean;
  cree_le: string;
  derniere_notification: string | null;
}

export function AlertsPage() {
  const { profile, lang } = useAuth();
  const { currentEspace, role } = useEspace();
  const isAdmin = role === "admin";
  const version = useDataVersion();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [aType, setAType] = useState<Alert["type"]>("solde_bas");
  const [aSeuil, setASeuil] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadAlerts = useCallback(async () => {
    if (!currentEspace) { setLoading(false); return; }
    const rows = await db.alertes.where("espace_id").equals(currentEspace.id).toArray();
    setAlerts(rows.filter((r) => !r.deleted).map((r) => ({ id: r.id!, type: r.type, seuil: r.seuil, active: r.active, cree_le: r.cree_le ?? "", derniere_notification: null })));
    setLoading(false);
  }, [currentEspace]);

  useEffect(() => { loadAlerts(); }, [loadAlerts, version]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const seuil = parseFloat(aSeuil);
    if (!profile || !currentEspace || !Number.isFinite(seuil) || seuil < 0) return;
    setSubmitting(true);
    await db.alertes.add({ uuid: genId(), type: aType, seuil, active: true, espace_id: currentEspace.id, cree_le: new Date().toISOString(), dirty: dirtyFlag() });
    notifyDataChanged();
    setModalOpen(false);
    setASeuil("");
    loadAlerts();
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t(lang, "confirmDelete"))) return;
    await removeDirty("alertes", id);
  };

  const toggleActive = async (a: Alert) => {
    await updateDirty("alertes", a.id, { active: !a.active });
  };

  return (
    <Layout
      title={t(lang, "alertsTitle")}
      subtitle={t(lang, "alertsHint")}
      actions={isAdmin ? <button onClick={() => setModalOpen(true)} className="btn-primary"><Plus size={16} />{t(lang, "addAlert")}</button> : <span className="badge-operator">{t(lang, "readOnly")}</span>}
    >
      {loading ? (
        <div className="flex justify-center py-20 text-slate-500">{t(lang, "loading")}</div>
      ) : alerts.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-20 text-slate-500">
          <Bell size={36} className="opacity-40" />
          <div className="text-sm font-medium">{t(lang, "noAlerts")}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {alerts.map((a) => (
            <div key={a.id} className="card card-hover p-5">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                  <Bell size={18} />
                </div>
                {isAdmin ? <div className="flex items-center gap-1">
                  <button
                    onClick={() => toggleActive(a)}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${a.active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"}`}
                  >
                    {a.active ? t(lang, "active") : t(lang, "inactive")}
                  </button>
                  <button onClick={() => handleDelete(a.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400" aria-label={t(lang, "delete")}>
                    <Trash2 size={14} />
                  </button>
                </div> : (
                  <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${a.active ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-500/15 text-slate-400"}`}>{a.active ? t(lang, "active") : t(lang, "inactive")}</span>
                )}
              </div>
              <div className="text-sm font-bold text-white">{t(lang, `alert_${a.type}`)}</div>
              <div className="mt-2 text-2xl font-extrabold text-amber-400">{formatAriary(a.seuil, lang)}</div>
              <div className="mt-1 text-xs text-slate-500">{t(lang, "alertThreshold")}</div>
              {a.derniere_notification && (
                <div className="mt-3 border-t border-white/10 pt-2 text-xs text-slate-500">
                  {formatDateTime(a.derniere_notification, lang)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="card relative z-10 w-full max-w-md animate-fade-up p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{t(lang, "addAlert")}</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="input-label">{t(lang, "alertType")}</label>
                <select value={aType} onChange={(e) => setAType(e.target.value as Alert["type"])} className="input">
                  <option value="solde_bas">{t(lang, "alert_solde_bas")}</option>
                  <option value="grosse_depense">{t(lang, "alert_grosse_depense")}</option>
                </select>
              </div>
              <div>
                <label className="input-label">{t(lang, "alertThreshold")} (Ar)</label>
                <input type="number" inputMode="decimal" step="any" min="0" required value={aSeuil} onChange={(e) => setASeuil(e.target.value)} className="input" placeholder="0" />
              </div>
              <button type="submit" disabled={submitting} className="btn-primary w-full">{submitting ? t(lang, "loading") : t(lang, "save")}</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
