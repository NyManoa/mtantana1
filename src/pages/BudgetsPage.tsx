import { useCallback, useEffect, useState } from "react";
import { Target, Plus, X, Trash2, AlertTriangle } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useTransactions } from "@/lib/useTransactions";
import { db } from "@/lib/db";
import { t, categoryLabel } from "@/lib/i18n";
import { formatAriary, currentMonthYear, monthLabel } from "@/lib/format";
import { ProgressBar } from "@/components/charts/ProgressBar";

interface Budget {
  id: number;
  categorie: string;
  mois_annee: string;
  limite: number;
}

export function BudgetsPage() {
  const { profile, lang } = useAuth();
  const { currentEspace } = useEspace();
  const { transactions, categories } = useTransactions();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [bCat, setBCat] = useState("nourriture");
  const [bMonth, setBMonth] = useState(currentMonthYear());
  const [bLimit, setBLimit] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isAdmin = profile?.role === "admin";

  const loadBudgets = useCallback(async () => {
    if (!currentEspace) { setLoading(false); return; }
    const rows = await db.budgets.where("espace_id").equals(currentEspace.id).reverse().sortBy("mois_annee");
    setBudgets(rows as Budget[]);
    setLoading(false);
  }, [currentEspace]);

  useEffect(() => { loadBudgets(); }, [loadBudgets]);

  const spentByCategory = (cat: string, month: string) => {
    return transactions
      .filter((r) => r.statut === "validee" && r.type_operation === "mivoaka" && r.categorie === cat && r.date_transaction.startsWith(month))
      .reduce((s, r) => s + r.montant, 0);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !currentEspace) return;
    setSubmitting(true);
    const existing = await db.budgets.where("espace_id").equals(currentEspace.id).toArray();
    const found = existing.find(b => b.categorie === bCat && b.mois_annee === bMonth);
    if (found?.id) {
      await db.budgets.update(found.id, { limite: parseFloat(bLimit) });
    } else {
      await db.budgets.add({
        categorie: bCat,
        mois_annee: bMonth,
        limite: parseFloat(bLimit),
        espace_id: currentEspace.id,
      });
    }
    setModalOpen(false);
    setBLimit("");
    loadBudgets();
    setSubmitting(false);
  };

  const handleDelete = async (id: number) => {
    await db.budgets.delete(id);
    loadBudgets();
  };

  return (
    <Layout
      title={t(lang, "budgets")}
      subtitle={t(lang, "adminView")}
      actions={isAdmin ? (
        <button onClick={() => setModalOpen(true)} className="btn-primary"><Plus size={16} />{t(lang, "addBudget")}</button>
      ) : undefined}
    >
      {loading ? (
        <div className="flex justify-center py-20 text-slate-500">{t(lang, "loading")}</div>
      ) : budgets.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-20 text-slate-500">
          <Target size={36} className="opacity-40" />
          <div className="text-sm font-medium">{t(lang, "noBudgets")}</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {budgets.map((b) => {
            const spent = spentByCategory(b.categorie, b.mois_annee);
            const pct = b.limite > 0 ? Math.round((spent / b.limite) * 100) : 0;
            const catColor = categories.find((c) => c.nom === b.categorie)?.couleur ?? "#10b981";
            const exceeded = spent > b.limite;
            const nearLimit = pct >= 80 && !exceeded;
            return (
              <div key={b.id} className="card card-hover p-5">
                <div className="mb-3 flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="h-3 w-3 rounded-sm" style={{ backgroundColor: catColor }} />
                      <span className="text-sm font-bold text-white">{categoryLabel(lang, b.categorie)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-500">{monthLabel(b.mois_annee, lang)}</div>
                  </div>
                  {isAdmin && (
                    <button onClick={() => handleDelete(b.id)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                <ProgressBar used={spent} limit={b.limite} color={catColor} />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-slate-400">{formatAriary(spent, lang)} / {formatAriary(b.limite, lang)}</span>
                  <span className={exceeded ? "font-bold text-rose-400" : nearLimit ? "font-bold text-amber-400" : "font-semibold text-slate-300"}>
                    {pct}%
                  </span>
                </div>
                {exceeded && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-rose-400"><AlertTriangle size={12} />{t(lang, "budgetExceeded")}</div>
                )}
                {nearLimit && (
                  <div className="mt-2 flex items-center gap-1.5 text-xs text-amber-400"><AlertTriangle size={12} />{t(lang, "budgetNearLimit")}</div>
                )}
                <div className="mt-1 text-xs text-slate-500">
                  {t(lang, "budgetRemaining", { n: new Intl.NumberFormat("fr-FR").format(Math.max(b.limite - spent, 0)) })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="card relative z-10 w-full max-w-md animate-fade-up p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{t(lang, "setBudget")}</h2>
              <button onClick={() => setModalOpen(false)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="input-label">{t(lang, "category")}</label>
                <select value={bCat} onChange={(e) => setBCat(e.target.value)} className="input">
                  {categories.map((c) => <option key={c.id} value={c.nom}>{categoryLabel(lang, c.nom)}</option>)}
                </select>
              </div>
              <div>
                <label className="input-label">{t(lang, "month")}</label>
                <input type="month" value={bMonth} onChange={(e) => setBMonth(e.target.value)} className="input" />
              </div>
              <div>
                <label className="input-label">{t(lang, "budgetLimit")} (Ar)</label>
                <input type="number" step="0.01" min="0" value={bLimit} onChange={(e) => setBLimit(e.target.value)} placeholder="0" className="input" />
              </div>
              <button type="submit" disabled={submitting} className="btn-primary w-full">{submitting ? t(lang, "loading") : t(lang, "save")}</button>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
