import { useCallback, useEffect, useState } from "react";
import { Repeat, Plus, X, Trash2, Calendar, Clock, Bell, CheckCircle2, CalendarClock } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useTransactions } from "@/lib/useTransactions";
import { useToast } from "@/components/Toast";
import { db, genId } from "@/lib/db";
import { t, categoryLabel } from "@/lib/i18n";
import { formatAriary, formatDate, todayISO } from "@/lib/format";

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
}

interface Scheduled {
  id: number;
  titre: string;
  motif: string;
  categorie: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  date_prevue: string;
  alerte_jours_avant: number;
  statut: "en_attente" | "realisee" | "annulee";
  cree_le: string;
}

export function RecurringPage() {
  const { profile, lang } = useAuth();
  const { currentEspace } = useEspace();
  const { categories, createTransaction } = useTransactions();
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
    const active = rows.filter(r => r.actif).sort((a, b) => a.prochaine_occurrence.localeCompare(b.prochaine_occurrence));
    setRecurring(active as Recurring[]);
  }, [currentEspace]);

  const loadScheduled = useCallback(async () => {
    if (!currentEspace) return;
    const rows = await db.scheduled.where("espace_id").equals(currentEspace.id).toArray();
    const pending = rows.filter(r => r.statut === "en_attente").sort((a, b) => a.date_prevue.localeCompare(b.date_prevue));
    setScheduled(pending as Scheduled[]);
  }, [currentEspace]);

  useEffect(() => {
    Promise.all([loadRecurring(), loadScheduled()]).finally(() => setLoading(false));
  }, [loadRecurring, loadScheduled]);

  useEffect(() => {
    if (scheduled.length === 0) return;
    const today = todayISO();
    for (const s of scheduled) {
      const daysDiff = Math.floor((new Date(s.date_prevue).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff <= s.alerte_jours_avant && daysDiff >= 0) {
        const key = `sched_alert_${s.id}`;
        if (!localStorage.getItem(key)) {
          showToast(t(lang, "upcomingAlertHint", { titre: s.titre, date: formatDate(s.date_prevue, lang) }), "success");
          localStorage.setItem(key, "1");
        }
      }
    }
  }, [scheduled, lang, showToast]);

  const computeNext = (date: string, freq: Recurring["frequence"]): string => {
    const d = new Date(date);
    switch (freq) {
      case "quotidien": d.setDate(d.getDate() + 1); break;
      case "hebdomadaire": d.setDate(d.getDate() + 7); break;
      case "mensuel": d.setMonth(d.getMonth() + 1); break;
      case "annuel": d.setFullYear(d.getFullYear() + 1); break;
    }
    return d.toISOString().slice(0, 10);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !rMotif.trim() || !rMontant || !currentEspace) return;
    setSubmitting(true);
    await db.recurring.add({
      date_depart: rDate,
      frequence: rFreq,
      prochaine_occurrence: computeNext(rDate, rFreq),
      motif: rMotif.trim(),
      categorie: rCat,
      type_operation: rType,
      montant: parseFloat(rMontant),
      auteur_id: profile.id,
      actif: true,
      espace_id: currentEspace.id,
      cree_le: new Date().toISOString(),
    });
    setModalOpen(false);
    setRMotif("");
    setRMontant("");
    loadRecurring();
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    await db.recurring.update(id, { actif: false });
    loadRecurring();
  };

  const handleSchedSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !sTitre.trim() || !sMontant || !currentEspace) return;
    setSchedSubmitting(true);
    await db.scheduled.add({
      titre: sTitre.trim(),
      motif: sMotif.trim(),
      categorie: sCat,
      type_operation: sType,
      montant: parseFloat(sMontant),
      date_prevue: sDate,
      alerte_jours_avant: parseInt(sAlertDays) || 1,
      auteur_id: profile.id,
      statut: "en_attente",
      espace_id: currentEspace.id,
      cree_le: new Date().toISOString(),
    });
    setSchedModalOpen(false);
    setSTitre("");
    setSMotif("");
    setSMontant("");
    loadScheduled();
    setSchedSubmitting(false);
  };

  const handleSchedDone = async (s: Scheduled) => {
    if (profile) {
      await createTransaction({
        client_uuid: genId(),
        date_transaction: s.date_prevue,
        motif: s.motif || s.titre,
        type_operation: s.type_operation,
        montant: s.montant,
        categorie: s.categorie,
      });
    }
    await db.scheduled.update(s.id, { statut: "realisee" });
    localStorage.removeItem(`sched_alert_${s.id}`);
    loadScheduled();
  };

  const handleSchedCancel = async (id: number) => {
    await db.scheduled.update(id, { statut: "annulee" });
    localStorage.removeItem(`sched_alert_${id}`);
    loadScheduled();
  };

  const today = todayISO();
  const upcomingAlerts = scheduled.filter((s) => {
    const daysDiff = Math.floor((new Date(s.date_prevue).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
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
            const daysDiff = Math.floor((new Date(s.date_prevue).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
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
                <button onClick={() => handleSchedDone(s)} className="btn-primary !py-1.5 !px-3 !text-xs">
                  <CheckCircle2 size={14} />
                  {t(lang, "markAsDone")}
                </button>
                <button onClick={() => handleSchedCancel(s.id)} className="btn-ghost !py-1.5 !px-2 !text-xs">
                  <X size={14} />
                </button>
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
              const daysDiff = Math.floor((new Date(s.date_prevue).getTime() - new Date(today).getTime()) / (1000 * 60 * 60 * 24));
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
                    <button onClick={() => handleSchedDone(s)} className="btn-primary !py-1.5 !px-2.5 !text-xs flex-1">
                      <CheckCircle2 size={13} />{t(lang, "markAsDone")}
                    </button>
                    <button onClick={() => handleSchedCancel(s.id)} className="btn-ghost !py-1.5 !px-2 !text-xs">
                      <X size={13} />
                    </button>
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
                  <button onClick={() => handleDelete(r.id)} className="rounded-lg p-1 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400">
                    <Trash2 size={13} />
                  </button>
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
