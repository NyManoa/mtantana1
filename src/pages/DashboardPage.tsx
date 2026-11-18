import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Trophy,
  Users as UsersIcon,
  AlertTriangle,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useTransactions } from "@/lib/useTransactions";
import { useDataVersion } from "@/lib/sync";
import { db, type LocalAlerte } from "@/lib/db";
import { t, categoryLabel } from "@/lib/i18n";
import { formatAriary, formatDate, currentMonthYear, previousMonthYear, monthLabel, lastMonths } from "@/lib/format";
import { MonthlyBarChart, type MonthlyPoint } from "@/components/charts/MonthlyBarChart";
import { CategoryPieChart, type PieSlice } from "@/components/charts/CategoryPieChart";


export function DashboardPage() {
  const { profile, lang } = useAuth();
  const { role, currentEspace } = useEspace();
  const { transactions, categories } = useTransactions();
  const version = useDataVersion();
  const [alertes, setAlertes] = useState<LocalAlerte[]>([]);

  useEffect(() => {
    if (!currentEspace) return;
    db.alertes.where("espace_id").equals(currentEspace.id).toArray().then((rows) => setAlertes(rows.filter((a) => a.active && !a.deleted)));
  }, [currentEspace, version]);

  const isAdmin = role === "admin";
  const thisMonth = currentMonthYear();
  const lastMonth = previousMonthYear(thisMonth);

  const stats = useMemo(() => {
    const validated = transactions.filter((r) => r.statut === "validee");
    const income = validated.filter((r) => r.type_operation === "miditra").reduce((s, r) => s + r.montant, 0);
    const expense = validated.filter((r) => r.type_operation === "mivoaka").reduce((s, r) => s + r.montant, 0);
    return { income, expense, balance: income - expense, count: validated.length };
  }, [transactions]);

  const monthlyData: MonthlyPoint[] = useMemo(() => {
    return lastMonths(6).map((m) => {
      const monthRows = transactions.filter(
        (r) => r.statut === "validee" && r.date_transaction.startsWith(m)
      );
      return {
        month: monthLabel(m, lang),
        income: monthRows.filter((r) => r.type_operation === "miditra").reduce((s, r) => s + r.montant, 0),
        expense: monthRows.filter((r) => r.type_operation === "mivoaka").reduce((s, r) => s + r.montant, 0),
      };
    });
  }, [transactions, lang]);

  const categoryData: PieSlice[] = useMemo(() => {
    const expenses = transactions.filter((r) => r.statut === "validee" && r.type_operation === "mivoaka");
    const byCat = new Map<string, number>();
    for (const r of expenses) byCat.set(r.categorie, (byCat.get(r.categorie) ?? 0) + r.montant);
    return Array.from(byCat.entries())
      .map(([cat, total]) => ({
        categorie: cat,
        couleur: categories.find((c) => c.nom === cat)?.couleur ?? "#64748b",
        total,
      }))
      .sort((a, b) => b.total - a.total);
  }, [transactions, categories]);

  const periodComparison = useMemo(() => {
    const thisMonthRows = transactions.filter((r) => r.statut === "validee" && r.date_transaction.startsWith(thisMonth));
    const lastMonthRows = transactions.filter((r) => r.statut === "validee" && r.date_transaction.startsWith(lastMonth));
    const calc = (rows: typeof transactions) => {
      const income = rows.filter((r) => r.type_operation === "miditra").reduce((s, r) => s + r.montant, 0);
      const expense = rows.filter((r) => r.type_operation === "mivoaka").reduce((s, r) => s + r.montant, 0);
      return { income, expense, balance: income - expense };
    };
    return { thisMonth: calc(thisMonthRows), lastMonth: calc(lastMonthRows) };
  }, [transactions, thisMonth, lastMonth]);

  const topMotifs = useMemo(() => {
    const expenses = transactions.filter((r) => r.statut === "validee" && r.type_operation === "mivoaka");
    const byMotif = new Map<string, number>();
    for (const r of expenses) byMotif.set(r.motif, (byMotif.get(r.motif) ?? 0) + r.montant);
    return Array.from(byMotif.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [transactions]);

  const statsByUser = useMemo(() => {
    const byUser = new Map<string, { nom: string; income: number; expense: number; count: number }>();
    for (const r of transactions.filter((r) => r.statut === "validee")) {
      const key = r.auteur_id;
      const existing = byUser.get(key) ?? { nom: r.auteur_nom ?? "?", income: 0, expense: 0, count: 0 };
      if (r.type_operation === "miditra") existing.income += r.montant;
      else existing.expense += r.montant;
      existing.count += 1;
      byUser.set(key, existing);
    }
    return Array.from(byUser.values()).sort((a, b) => b.income + b.expense - (a.income + a.expense));
  }, [transactions]);

  const recent = transactions.slice(0, 6);

  // Alertes configurées dans la page « Alertes » : évaluées ici en temps réel.
  const triggered = useMemo(() => {
    const out: string[] = [];
    const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    for (const a of alertes) {
      if (a.type === "solde_bas" && stats.balance < a.seuil) {
        out.push(t(lang, "alertLowBalance", { solde: formatAriary(stats.balance, lang), seuil: formatAriary(a.seuil, lang) }));
      }
      if (a.type === "grosse_depense") {
        transactions
          .filter((r) => r.type_operation === "mivoaka" && r.montant >= a.seuil && r.date_transaction >= monthAgo)
          .slice(0, 3)
          .forEach((r) => out.push(t(lang, "alertBigExpense", { motif: r.motif, montant: formatAriary(r.montant, lang) })));
      }
    }
    return out;
  }, [alertes, stats.balance, transactions, lang]);

  return (
    <Layout
      title={`${t(lang, "welcomeBack")}, ${profile?.nom ?? ""}`}
      subtitle={isAdmin ? t(lang, "adminView") : t(lang, "superviseurView")}
    >
      {triggered.length > 0 && (
        <div role="alert" className="mb-5 space-y-1.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          {triggered.map((m, i) => (
            <div key={i} className="flex items-center gap-2 text-sm text-amber-200">
              <AlertTriangle size={15} className="shrink-0 text-amber-400" />
              {m}
            </div>
          ))}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card card-hover relative overflow-hidden p-5">
          <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-emerald-500/10 blur-2xl" />
          <div className="flex items-center justify-between">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400"><Wallet size={20} /></div>
            <LayoutDashboard size={16} className="text-slate-600" />
          </div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "currentBalance")}</div>
          <div className={`mt-1 text-2xl font-extrabold ${stats.balance >= 0 ? "text-emerald-400 glow-pos" : "text-rose-400 glow-neg"}`}>{formatAriary(stats.balance, lang)}</div>
        </div>
        <div className="card card-hover p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400"><TrendingUp size={20} /></div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "totalIncome")}</div>
          <div className="mt-1 text-2xl font-extrabold text-emerald-400">{formatAriary(stats.income, lang)}</div>
        </div>
        <div className="card card-hover p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400"><TrendingDown size={20} /></div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "totalExpense")}</div>
          <div className="mt-1 text-2xl font-extrabold text-rose-400">{formatAriary(stats.expense, lang)}</div>
        </div>
        <div className="card card-hover p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400"><LayoutDashboard size={20} /></div>
          <div className="mt-4 text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "transactions")}</div>
          <div className="mt-1 text-2xl font-extrabold text-white">{stats.count}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-white">{t(lang, "monthlyOverview")}</h2>
            <p className="text-xs text-slate-500">{t(lang, "monthlyOverviewHint")}</p>
          </div>
          <div className="flex items-center gap-4 mb-3">
            <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-emerald-400" /><span className="text-xs text-slate-400">{t(lang, "income")}</span></div>
            <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-rose-400" /><span className="text-xs text-slate-400">{t(lang, "expense")}</span></div>
          </div>
          <MonthlyBarChart data={monthlyData} lang={lang} />
        </div>

        <div className="card p-5">
          <div className="mb-4">
            <h2 className="text-sm font-bold text-white">{t(lang, "categoryBreakdown")}</h2>
            <p className="text-xs text-slate-500">{t(lang, "categoryBreakdownHint")}</p>
          </div>
          <CategoryPieChart data={categoryData} lang={lang} />
        </div>
      </div>

      {/* Period comparison */}
      <div className="mt-6 card p-5">
        <h2 className="mb-4 text-sm font-bold text-white">{t(lang, "comparisonTitle")}</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "thisMonth")}</div>
            <div className="mt-2 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-slate-500">{t(lang, "income")}</span><span className="font-semibold text-emerald-400">{formatAriary(periodComparison.thisMonth.income, lang)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">{t(lang, "expense")}</span><span className="font-semibold text-rose-400">{formatAriary(periodComparison.thisMonth.expense, lang)}</span></div>
              <div className="flex justify-between border-t border-white/10 pt-1.5 text-sm"><span className="text-slate-400">{t(lang, "currentBalance")}</span><span className={`font-bold ${periodComparison.thisMonth.balance >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatAriary(periodComparison.thisMonth.balance, lang)}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "lastMonth")}</div>
            <div className="mt-2 space-y-1.5">
              <div className="flex justify-between text-sm"><span className="text-slate-500">{t(lang, "income")}</span><span className="font-semibold text-emerald-400">{formatAriary(periodComparison.lastMonth.income, lang)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">{t(lang, "expense")}</span><span className="font-semibold text-rose-400">{formatAriary(periodComparison.lastMonth.expense, lang)}</span></div>
              <div className="flex justify-between border-t border-white/10 pt-1.5 text-sm"><span className="text-slate-400">{t(lang, "currentBalance")}</span><span className={`font-bold ${periodComparison.lastMonth.balance >= 0 ? "text-emerald-400" : "text-rose-400"}`}>{formatAriary(periodComparison.lastMonth.balance, lang)}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Top motifs + stats by user */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Trophy size={16} className="text-amber-400" />
            <h2 className="text-sm font-bold text-white">{t(lang, "topMotifs")}</h2>
          </div>
          {topMotifs.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">{t(lang, "noTransactions")}</div>
          ) : (
            <div className="space-y-2">
              {topMotifs.map(([motif, total], i) => (
                <div key={motif} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-slate-300">{i + 1}</span>
                  <span className="flex-1 truncate text-sm text-slate-200">{motif}</span>
                  <span className="font-semibold text-rose-400">{formatAriary(total, lang)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2">
            <UsersIcon size={16} className="text-sky-400" />
            <h2 className="text-sm font-bold text-white">{t(lang, "statsByUser")}</h2>
          </div>
          {statsByUser.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-500">{t(lang, "noTransactions")}</div>
          ) : (
            <div className="space-y-2">
              {statsByUser.map((u, i) => (
                <div key={i} className="flex items-center gap-3 rounded-lg border border-white/5 p-2.5">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-xs font-bold text-white">{u.nom.charAt(0).toUpperCase()}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-200">{u.nom}</div>
                    <div className="text-xs text-slate-500">{u.count} {t(lang, "transactions")}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-emerald-400">+{formatAriary(u.income, lang)}</div>
                    <div className="text-xs text-rose-400">-{formatAriary(u.expense, lang)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent */}
      <div className="mt-6 card overflow-hidden">
        <div className="border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-bold text-white">{t(lang, "allTransactions")}</h2>
        </div>
        {recent.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">{t(lang, "noTransactions")}</div>
        ) : (
          <div className="divide-y divide-white/5">
            {recent.map((tx, i) => (
              <div key={`${tx.client_uuid}-${i}`} className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-white/[0.02]">
                <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${tx.type_operation === "miditra" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"}`}>
                  {tx.type_operation === "miditra" ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-200">{tx.motif}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(tx.date_transaction, lang)} · {categoryLabel(lang, tx.categorie)}
                    {isAdmin && tx.auteur_nom ? ` · ${tx.auteur_nom}` : ""}
                  </div>
                </div>
                <div className={`whitespace-nowrap text-sm font-bold ${tx.type_operation === "miditra" ? "text-emerald-400" : "text-rose-400"}`}>
                  {tx.type_operation === "miditra" ? "+" : "-"}{formatAriary(tx.montant, lang)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
