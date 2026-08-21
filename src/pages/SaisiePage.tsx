import { useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Calendar, FileText, Coins, Tag, CheckCircle2, AlertTriangle, Undo2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useTransactions } from "@/lib/useTransactions";
import { t, type Lang, categoryLabel } from "@/lib/i18n";
import { todayISO } from "@/lib/format";
import { genClientUuid } from "@/lib/db";

export function SaisiePage() {
  const { profile, lang } = useAuth();
  const { categories, validationThreshold, createTransaction, deleteTransaction, transactions } = useTransactions();
  const [date, setDate] = useState(todayISO());
  const [motif, setMotif] = useState("");
  const [type, setType] = useState<"miditra" | "mivoaka">("miditra");
  const [montant, setMontant] = useState("");
  const [categorie, setCategorie] = useState("autre");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{ uuid: string; motif: string; montant: number; type: "miditra" | "mivoaka"; ts: number } | null>(null);
  const [undoExpired, setUndoExpired] = useState(false);

  if (!profile) return null;

  const amt = parseFloat(montant);
  const willNeedValidation = !isNaN(amt) && amt >= validationThreshold;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!motif.trim() || !montant || !date) {
      setError(t(lang, "fillAllFields"));
      return;
    }
    if (isNaN(amt) || amt <= 0) {
      setError(t(lang, "fillAllFields"));
      return;
    }
    setSubmitting(true);
    const uuid = genClientUuid();
    try {
      await createTransaction({
        client_uuid: uuid,
        date_transaction: date,
        motif: motif.trim(),
        type_operation: type,
        montant: amt,
        categorie,
      });
      setConfirmation({ uuid, motif: motif.trim(), montant: amt, type, ts: Date.now() });
      setMotif("");
      setMontant("");
      setCategorie("autre");
      setType("miditra");
      setDate(todayISO());
      setUndoExpired(false);
      setTimeout(() => setUndoExpired(true), 30000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(lang, "error"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleUndo = async () => {
    if (!confirmation || Date.now() - confirmation.ts > 30000) {
      setUndoExpired(true);
      return;
    }
    await deleteTransaction(confirmation.uuid);
    setConfirmation(null);
  };

  const resetForm = () => {
    setConfirmation(null);
    setUndoExpired(false);
  };

  if (confirmation) {
    return (
      <Layout title={t(lang, "saisieTitle")} subtitle={t(lang, "viewConfirmation")}>
        <div className="mx-auto max-w-md">
          <div className="card animate-fade-up p-8 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15">
              <CheckCircle2 size={32} className="text-emerald-400" />
            </div>
            <h2 className="text-lg font-bold text-white">{t(lang, "transactionSaved")}</h2>
            <p className="mt-1 text-sm text-slate-400">{t(lang, "transactionSavedHint")}</p>

            <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-4 text-left">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{t(lang, "motif")}</span>
                <span className="text-sm font-medium text-slate-200">{confirmation.motif}</span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">{t(lang, "type")}</span>
                <span className={`text-sm font-semibold ${confirmation.type === "miditra" ? "text-emerald-400" : "text-rose-400"}`}>
                  {t(lang, confirmation.type)}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xs text-slate-500">{t(lang, "amount")}</span>
                <span className={`text-lg font-bold ${confirmation.type === "miditra" ? "text-emerald-400" : "text-rose-400"}`}>
                  {confirmation.type === "miditra" ? "+" : "-"}
                  {new Intl.NumberFormat("fr-FR").format(confirmation.montant)} Ar
                </span>
              </div>
            </div>

            {!undoExpired && (
              <button onClick={handleUndo} className="btn-secondary mt-4 w-full">
                <Undo2 size={16} />
                {t(lang, "undoLast")}
              </button>
            )}

            <button onClick={resetForm} className="btn-primary mt-3 w-full">
              {t(lang, "addAnother")}
            </button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout title={t(lang, "saisieTitle")} subtitle={t(lang, "saisieSubtitle")}>
      <div className="mx-auto max-w-md">
        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="input-label">{t(lang, "type")}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setType("miditra")}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    type === "miditra" ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  <ArrowDownCircle size={18} />
                  {t(lang, "miditra")}
                </button>
                <button
                  type="button"
                  onClick={() => setType("mivoaka")}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition ${
                    type === "mivoaka" ? "border-rose-500/60 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                  }`}
                >
                  <ArrowUpCircle size={18} />
                  {t(lang, "mivoaka")}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="input-label">{t(lang, "date")}</label>
                <div className="relative">
                  <Calendar size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input pl-10" />
                </div>
              </div>
              <div>
                <label className="input-label">{t(lang, "amount")} (Ar)</label>
                <div className="relative">
                  <Coins size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="number" step="0.01" min="0" value={montant} onChange={(e) => setMontant(e.target.value)} placeholder="0" className="input pl-10" />
                </div>
              </div>
            </div>

            <div>
              <label className="input-label">{t(lang, "category")}</label>
              <div className="relative">
                <Tag size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <select value={categorie} onChange={(e) => setCategorie(e.target.value)} className="input pl-10">
                  {categories.map((c) => (
                    <option key={c.id} value={c.nom}>{categoryLabel(lang, c.nom)}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="input-label">{t(lang, "motif")}</label>
              <div className="relative">
                <FileText size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="text" value={motif} onChange={(e) => setMotif(e.target.value)} placeholder={t(lang, "motif")} className="input pl-10" />
              </div>
            </div>

            {willNeedValidation && (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-300">
                <AlertTriangle size={16} />
                {t(lang, "thresholdWarning")}
              </div>
            )}

            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>
            )}

            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? t(lang, "loading") : t(lang, "save")}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  );
}
