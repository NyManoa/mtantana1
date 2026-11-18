import { useCallback, useEffect, useState } from "react";
import { Repeat, Plus, X, Trash2, Calendar, Clock, Bell, CheckCircle2, CalendarClock } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useTransactions, generateDueRecurring } from "@/lib/useTransactions";
import { useDataVersion } from "@/lib/sync";
import { useToast } from "@/components/Toast";
import { db, dirtyFlag, genId, notifyDataChanged, updateDirty } from "@/lib/db";
import { t, categoryLabel } from "@/lib/i18n";
import { formatAriary, formatDate, todayISO, daysUntil } from "@/lib/format";
import { cancelOrder, canExecute, executeOrder, type Order } from "@/lib/ordres";

interface Recurring {
  id: number;
  date_depart: string;
  frequence: "quotidien" | "hebdomadaire" | "mensuel" | "annuel";
  prochaine_occurrence: string;
  motif: string;
  categorie: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  actif: boolean;
  cree_le: string;
  auteur_id: string;
}

type Scheduled = Order;

export function RecurringPage() {
  const { profile, lang } = useAuth();
  const { currentEspace, role } = useEspace();
  const { categories, validationThreshold } = useTransactions();
  const version = useDataVersion();
  const { show: showToast } = useToast();
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [scheduled, setScheduled] = useState<Scheduled[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [schedModalOpen, setSchedModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [schedSubmitting, setSchedSubmitting] = useState(false);

  const [rDate, setRDate] = useState(todayISO());
  const [rFreq, setRFreq] = useState<Recurring["frequence"]>("mensuel");
  const [rMotif, setRMotif] = useState("");
  const [rCat, setRCat] = useState("autre");
  const [rType, setRType] = useState<"miditra" | "mivoaka">("mivoaka");
  const [rMontant, setRMontant] = useState("");

  const [sTitre, setSTitre] = useState("");
  const [sMotif, setSMotif] = useState("");
  const [sCat, setSCat] = useState("autre");
  const [sType, setSType] = useState<"miditra" | "mivoaka">("mivoaka");
  const [sMontant, setSMontant] = useState("");
  const [sDate, setSDate] = useState(todayISO());
  const [sAlertDays, setSAlertDays] = useState("1");

  const loadRecurring = useCallback(async () => {
    if (!currentEspace) return;
    const rows = await db.recurring.where("espace_id").equals(currentEspace.id).toArray();
    const active = rows.filter(r => r.actif && !r.deleted && (role !== "operateur" || r.auteur_id === profile?.id)).sort((a, b) => a.prochaine_occurrence.localeCompare(b.prochaine_occurrence));
    setRecurring(active.map((r) => ({ ...r, id: r.id! })));
  }, [currentEspace, role, profile?.id]);

  const loadScheduled = useCallback(async () => {
    if (!currentEspace) return;
    const rows = await db.scheduled.where("espace_id").equals(currentEspace.id).toArray();
    const pending = rows.filter(r => r.statut === "en_attente" && !r.deleted && (role !== "operateur" || r.auteur_id === profile?.id || r.assigne_a === profile?.id)).sort((a, b) => a.date_prevue.localeCompare(b.date_prevue));
    setScheduled(pending.map((s) => ({ ...s, id: s.id! })));
  }, [currentEspace, role, profile?.id]);

  useEffect(() => {
    Promise.all([loadRecurring(), loadScheduled()]).finally(() => setLoading(false));
  }, [loadRecurring, loadScheduled, version]);

  // Les rappels d'échéance sont affichés par le centre de notifications (une fois par jour).

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const montant = parseFloat(rMontant);
    if (!profile || !rMotif.trim() || !Number.isFinite(montant) || montant <= 0 || !currentEspace) return;
    setSubmitting(true);
    await db.recurring.add({
      uuid: genId(),
      date_depart: rDate,
      frequence: rFreq,
      // La première occurrence est la date de départ elle-même.
      prochaine_occurrence: rDate,
      motif: rMotif.trim(),
      categorie: rCat,
      type_operation: rType,
      montant,
      auteur_id: profile.id,
      actif: true,
      espace_id: currentEspace.id,
      cree_le: new Date().toISOString(),
      dirty: dirtyFlag(),
    });
    notifyDataChanged();
    await generateDueRecurring(currentEspace.id, profile.id);
    setModalOpen(false);
    setRMotif("");
    setRMontant("");
    loadRecurring();
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t(lang, "confirmDelete"))) return;
    await updateDirty("recurring", id, { actif: false });
  };

  const handleSchedSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const sAmount = parseFloat(sMontant);
    if (!profile || !sTitre.trim() || !Number.isFinite(sAmount) || sAmount < 0 || !currentEspace) return;
    setSchedSubmitting(true);
    await db.scheduled.add({
      uuid: genId(),
      titre: sTitre.trim(),
      motif: sMotif.trim(),
      categorie: sCat,
      type_operation: sType,
      montant: sAmount,
      date_prevue: sDate,
      alerte_jours_avant: parseInt(sAlertDays) || 1,
      auteur_id: profile.id,
      statut: "en_attente",
      espace_id: currentEspace.id,
      cree_le: new Date().toISOString(),
      dirty: dirtyFlag(),
    });
    notifyDataChanged();
    setSchedModalOpen(false);
    setSTitre("");
    setSMotif("");
    setSMontant("");
    loadScheduled();
    setSchedSubmitting(false);
  };

  // Même circuit que la page Ordres : transaction liée, traces et notifications.
  const handleSchedDone = async (s: Scheduled) => {
    if (!profile) return;
    try {
      await executeOrder(s, profile.id, role, validationThreshold, todayISO());
      localStorage.removeItem(`sched_alert_${s.id}`);
      showToast(t(lang, "orderExecuted"), "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : t(lang, "error"), "error");
    }
  };

  const handleSchedCancel = async (s: Scheduled) => {
    if (!profile) return;
    await cancelOrder(s, profile.id, "");
    localStorage.removeItem(`sched_alert_${s.id}`);
  };

  const upcomingAlerts = scheduled.filter((s) => {
    const daysDiff = daysUntil(s.date_prevue);
    return daysDiff <= s.alerte_jours_avant && daysDiff >= 0;
  });

  return (
    <Layout
      title={t(lang, "recurringTitle")}
      subtitle={t(lang, "recurringHint")}
      actions={
        <div className="flex gap-2">
          <button onClick={() => setSchedModalOpen(true)} className="btn-secondary">
            <CalendarClock size={16} />
            <span className="hidden sm:inline">{t(lang, "addScheduled")}</span>
          </button>
          <button onClick={() => setModalOpen(true)} className="btn-primary">
            <Plus size={16} />
            <span className="hidden sm:inline">{t(lang, "addRecurring")}</span>
          </button>
        </div>
      }
    >
      {upcomingAlerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {upcomingAlerts.map((s) => {
            const daysDiff = daysUntil(s.date_prevue);
            return (
              <div key={s.id} className="card animate-fade-up flex items-center gap-3 border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400">
                  <Bell size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-white">{s.titre}</div>
                  <div className="text-xs text-amber-300/80">
                    {daysDiff === 0 ? t(lang, "todayLabel") : t(lang, "daysBefore", { n: daysDiff })}{" "}
                    — {formatDate(s.date_prevue, lang)} · {formatAriary(s.montant, lang)}
                  </div>
                </div>
                {profile && canExecute(s, profile.id, role) && (
                  <button onClick={() => handleSchedDone(s)} className="btn-primary !py-1.5 !px-3 !text-xs">
                    <CheckCircle2 size={14} />
                    {t(lang, "markAsDone")}
                  </button>
                )}
                {(role === "admin" || s.auteur_id === profile?.id) && (
                  <button onClick={() => handleSchedCancel(s)} className="btn-ghost !py-1.5 !px-2 !text-xs" aria-label={t(lang, "cancel")}>
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="mb-8">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <CalendarClock size={16} className="text-sky-400" />
          {t(lang, "scheduledTitle")}
        </h2>
        {scheduled.length === 0 ? (
          <div className="card flex flex-col items-center gap-2 py-10 text-slate-500">
            <CalendarClock size={28} className="opacity-40" />
            <div className="text-sm">{t(lang, "noScheduled")}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {scheduled.map((s) => {
              const daysDiff = daysUntil(s.date_prevue);
              const isAlert = daysDiff <= s.alerte_jours_avant && daysDiff >= 0;
              return (
                <div key={s.id} className={`card card-hover p-4 ${isAlert ? "border-amber-500/30" : ""}`}>
                  <div className="mb-2 flex items-start justify-between">
                    <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${s.type_operation === "miditra" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                      <CalendarClock size={15} />
                    </div>
                    {isAlert && <Bell size={14} className="text-amber-400" />}
                  </div>
                  <div className="text-sm font-bold text-white">{s.titre}</div>
                  <div className="mt-1 text-xs text-slate-500">{categoryLabel(lang, s.categorie)}</div>
                  <div className="mt-2 text-lg font-bold text-white">
                    {s.type_operation === "miditra" ? "+" : "-"}{formatAriary(s.montant, lang)}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 border-t border-white/10 pt-2 text-xs text-slate-500">
                    <Calendar size={11} />
                    {formatDate(s.date_prevue, lang)}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock size={11} />
                    {t(lang, "alertDays")}: {s.alerte_jours_avant}
                  </div>
                  <div className="mt-3 flex gap-1.5">
                    {profile && canExecute(s, profile.id, role) && (
                      <button onClick={() => handleSchedDone(s)} className="btn-primary !py-1.5 !px-2.5 !text-xs flex-1">
                        <CheckCircle2 size={13} />{t(lang, "markAsDone")}
                      </button>
                    )}
                    {(role === "admin" || s.auteur_id === profile?.id) && (
                      <button onClick={() => handleSchedCancel(s)} className="btn-ghost !py-1.5 !px-2 !text-xs" aria-label={t(lang, "cancel")}>
                        <X size={13} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
          <Repeat size={16} className="text-emerald-400" />
          {t(lang, "recurringTitle")}
        </h2>
        {loading ? (
          <div className="flex justify-center py-10 text-slate-500">{t(lang, "loading")}</div>
        ) : recurring.length === 0 ? (
          <div className="card flex flex-col items-center gap-3 py-10 text-slate-500">
            <Repeat size={28} className="opacity-40" />
            <div className="text-sm">{t(lang, "noRecurring")}</div>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {recurring.map((r) => (
              <div key={r.id} className="card card-hover p-4">
                <div className="mb-2 flex items-start justify-between">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${r.type_operation === "miditra" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                    <Repeat size={15} />
                  </div>
                  {(role === "admin" || r.auteur_id === profile?.id) && (
                    <button onClick={() => handleDelete(r.id)} className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400" aria-label={t(lang, "delete")}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <div className="text-sm font-bold text-white">{r.motif}</div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                  <span className="badge-operator !px-2 !py-0.5 !text-[10px]">{t(lang, `freq_${r.frequence}`)}</span>
                  <span>{categoryLabel(lang, r.categorie)}</span>
                </div>
                <div className="mt-2 text-lg font-bold text-white">
                  {r.type_operation === "miditra" ? "+" : "-"}{formatAriary(r.montant, lang)}
                </div>
                <div className="mt-2 flex items-center gap-1.5 border-t border-white/10 pt-2 text-xs text-slate-500">
                  <Calendar size={11} />
                  {t(lang, "nextOccurrence")}: {formatDate(r.prochaine_occurrence, lang)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="card relative z-10 w-full max-w-md animate-fade-up p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{t(lang, "addRecurring")}</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setRType("miditra")} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${rType === "miditra" ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-400"}`}>{t(lang, "miditra")}</button>
                <button type="button" onClick={() => setRType("mivoaka")} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${rType === "mivoaka" ? "border-rose-500/60 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/5 text-slate-400"}`}>{t(lang, "mivoaka")}</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">{t(lang, "startDate")}</label>
                  <input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="input-label">{t(lang, "frequency")}</label>
                  <select value={rFreq} onChange={(e) => setRFreq(e.target.value as Recurring["frequence"])} className="input">
                    <option value="quotidien">{t(lang, "freq_quotidien")}</option>
                    <option value="hebdomadaire">{t(lang, "freq_hebdomadaire")}</option>
                    <option value="mensuel">{t(lang, "freq_mensuel")}</option>
                    <option value="annuel">{t(lang, "freq_annuel")}</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="input-label">{t(lang, "category")}</label>
                <select value={rCat} onChange={(e) => setRCat(e.target.value)} className="input">
                  {categories.map((c) => <option key={c.id} value={c.nom}>{categoryLabel(lang, c.nom)}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">{t(lang, "motif")}</label>
                <input type="text" value={rMotif} onChange={(e) => setRMotif(e.target.value)} className="input" placeholder={t(lang, "motif")} />
              </div>
              <div>
                <label className="input-label">{t(lang, "amount")} (Ar)</label>
                <input type="number" step="0.01" min="0" value={rMontant} onChange={(e) => setRMontant(e.target.value)} className="input" placeholder="0" />
              </div>
              <button type="submit" disabled={submitting} className="btn-primary w-full">{submitting ? t(lang, "loading") : t(lang, "save")}</button>
            </form>
          </div>
        </div>
      )}

      {schedModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setSchedModalOpen(false)} />
          <div className="card relative z-10 w-full max-w-md animate-fade-up p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{t(lang, "addScheduled")}</h2>
              <button onClick={() => setSchedModalOpen(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleSchedSave} className="space-y-4">
              <div>
                <label className="input-label">{t(lang, "addTransaction")}</label>
                <input type="text" value={sTitre} onChange={(e) => setSTitre(e.target.value)} className="input" placeholder={t(lang, "addTransaction")} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSType("miditra")} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${sType === "miditra" ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-400"}`}>{t(lang, "miditra")}</button>
                <button type="button" onClick={() => setSType("mivoaka")} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${sType === "mivoaka" ? "border-rose-500/60 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/5 text-slate-400"}`}>{t(lang, "mivoaka")}</button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">{t(lang, "scheduledDate")}</label>
                  <input type="date" value={sDate} onChange={(e) => setSDate(e.target.value)} className="input" />
                </div>
                <div>
                  <label className="input-label">{t(lang, "alertDays")}</label>
                  <input type="number" min="0" max="30" value={sAlertDays} onChange={(e) => setSAlertDays(e.target.value)} className="input" />
                </div>
              </div>
              <p className="-mt-2 text-xs text-slate-500">{t(lang, "alertDaysHint")}</p>
              <div>
                <label className="input-label">{t(lang, "category")}</label>
                <select value={sCat} onChange={(e) => setSCat(e.target.value)} className="input">
                  {categories.map((c) => <option key={c.id} value={c.nom}>{categoryLabel(lang, c.nom)}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">{t(lang, "motif")}</label>
                <input type="text" value={sMotif} onChange={(e) => setSMotif(e.target.value)} className="input" placeholder={t(lang, "motif")} />
              </div>
              <div>
                <label className="input-label">{t(lang, "scheduledAmount")}</label>
                <input type="number" step="0.01" min="0" value={sMontant} onChange={(e) => setSMontant(e.target.value)} className="input" placeholder="0" />
              </div>
              <button type="submit" disabled={schedSubmitting} className="btn-primary w-full">{schedSubmitting ? t(lang, "loading") : t(lang, "save")}</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
