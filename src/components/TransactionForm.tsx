import { useState, useEffect } from "react";
import { X, Calendar, FileText, ArrowDownCircle, ArrowUpCircle, Coins, Tag, AlertTriangle } from "lucide-react";
import { t, type Lang, categoryLabel } from "@/lib/i18n";
import { todayISO } from "@/lib/format";
import { genClientUuid } from "@/lib/db";
import type { Category } from "@/lib/useTransactions";

export interface TransactionFormData {
  client_uuid: string;
  date_transaction: string;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
}

interface Props {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  onSubmit: (data: TransactionFormData) => Promise<void> | void;
  initial?: Partial<TransactionFormData>;
  mode?: "create" | "edit";
  categories: Category[];
  validationThreshold: number;
  isAdmin?: boolean;
}

export function TransactionForm({
  lang,
  open,
  onClose,
  onSubmit,
  initial,
  mode = "create",
  categories,
  validationThreshold,
  isAdmin = false,
}: Props) {
  const [date, setDate] = useState(initial?.date_transaction ?? todayISO());
  const [motif, setMotif] = useState(initial?.motif ?? "");
  const [type, setType] = useState<"miditra" | "mivoaka">(initial?.type_operation ?? "miditra");
  const [montant, setMontant] = useState<string>(initial?.montant ? String(initial.montant) : "");
  const [categorie, setCategorie] = useState(initial?.categorie ?? "autre");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDate(initial?.date_transaction ?? todayISO());
      setMotif(initial?.motif ?? "");
      setType(initial?.type_operation ?? "miditra");
      setMontant(initial?.montant ? String(initial.montant) : "");
      setCategorie(initial?.categorie ?? "autre");
      setError(null);
    }
  }, [open, initial]);

  if (!open) return null;

  const amt = parseFloat(montant);
  const willNeedValidation = !isNaN(amt) && amt >= validationThreshold && !isAdmin;

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
    try {
      await onSubmit({
        client_uuid: initial?.client_uuid ?? genClientUuid(),
        date_transaction: date,
        motif: motif.trim(),
        type_operation: type,
        montant: amt,
        categorie,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t(lang, "error"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative z-10 w-full max-w-md animate-fade-up p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">
            {mode === "edit" ? t(lang, "editTransaction") : t(lang, "addTransaction")}
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="input-label">{t(lang, "type")}</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setType("miditra")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  type === "miditra" ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                <ArrowDownCircle size={16} />
                {t(lang, "miditra")}
              </button>
              <button
                type="button"
                onClick={() => setType("mivoaka")}
                className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                  type === "mivoaka" ? "border-rose-500/60 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/5 text-slate-400 hover:bg-white/10"
                }`}
              >
                <ArrowUpCircle size={16} />
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
                  <option key={c.id} value={c.nom}>
                    {categoryLabel(lang, c.nom)}
                  </option>
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

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">{t(lang, "cancel")}</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1">
              {submitting ? t(lang, "loading") : t(lang, "save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
