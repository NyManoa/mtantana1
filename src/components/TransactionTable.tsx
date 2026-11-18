import { useMemo, useState } from "react";
import {
  Search,
  Filter,
  Download,
  Plus,
  Pencil,
  Trash2,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Inbox,
  Check,
  Tag,
} from "lucide-react";
import { t, type Lang, categoryLabel } from "@/lib/i18n";
import { formatAriary, formatDate } from "@/lib/format";
import { exportTransactionsExcel } from "@/lib/excel";
import { TransactionForm, type TransactionFormData } from "./TransactionForm";
import type { Category } from "@/lib/useTransactions";
import type { UserRole } from "@/lib/auth";

export interface TransactionRow {
  id: string;
  client_uuid: string;
  date_transaction: string;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
  statut: "validee" | "en_attente_validation";
  auteur_nom?: string;
  auteur_id?: string;
  cree_le: string;
  modifie_le?: string | null;
  synced?: boolean;
  pending_delete?: boolean;
}

interface Props {
  lang: Lang;
  rows: TransactionRow[];
  role: UserRole;
  /** Utilisateur courant : seuls l'admin et l'auteur peuvent modifier une ligne. */
  currentUserId?: string;
  showAuthor?: boolean;
  categories: Category[];
  validationThreshold: number;
  onCreate: (data: TransactionFormData) => Promise<void> | void;
  onUpdate: (clientUuid: string, data: TransactionFormData) => Promise<void> | void;
  onDelete: (clientUuid: string) => Promise<void> | void;
  onValidate?: (clientUuid: string) => Promise<void> | void;
}

type FilterType = "all" | "miditra" | "mivoaka";

export function TransactionTable({
  lang,
  rows,
  role,
  currentUserId,
  showAuthor = false,
  categories,
  validationThreshold,
  onCreate,
  onUpdate,
  onDelete,
  onValidate,
}: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<FilterType>("all");
  const [catFilter, setCatFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<TransactionRow | null>(null);

  const isAdmin = role === "admin";
  const canModify = (row: TransactionRow) => isAdmin || !row.auteur_id || row.auteur_id === currentUserId;
  const showTotals = role === "admin" || role === "superviseur";

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (typeFilter !== "all" && r.type_operation !== typeFilter) return false;
      if (catFilter !== "all" && r.categorie !== catFilter) return false;
      if (fromDate && r.date_transaction < fromDate) return false;
      if (toDate && r.date_transaction > toDate) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.motif} ${r.auteur_nom ?? ""} ${r.date_transaction} ${r.categorie}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, typeFilter, catFilter, fromDate, toDate]);

  const totals = useMemo(() => {
    const validated = filtered.filter((r) => r.statut === "validee");
    const income = validated.filter((r) => r.type_operation === "miditra").reduce((s, r) => s + r.montant, 0);
    const expense = validated.filter((r) => r.type_operation === "mivoaka").reduce((s, r) => s + r.montant, 0);
    return { income, expense, balance: income - expense };
  }, [filtered]);

  const withBalance = useMemo(() => {
    const asc = [...filtered].sort((a, b) => (a.date_transaction + a.cree_le).localeCompare(b.date_transaction + b.cree_le));
    let run = 0;
    const map = new Map<string, number>();
    for (const r of asc) {
      run += r.type_operation === "miditra" ? r.montant : -r.montant;
      map.set(r.client_uuid, run);
    }
    return map;
  }, [filtered]);

  const handleExport = () => {
    const defaultName = `mtantana-${new Date().toISOString().slice(0, 10)}`;
    const inputName = window.prompt(t(lang, "saveFileNamePrompt"), defaultName);
    if (inputName === null) return;
    const fileName = inputName.trim() || defaultName;
    exportTransactionsExcel(
      filtered.map((r) => ({
        date_transaction: r.date_transaction,
        motif: r.motif,
        type_operation: r.type_operation,
        montant: r.montant,
        categorie: r.categorie,
        auteur_nom: r.auteur_nom,
        cree_le: r.cree_le,
      })),
      lang,
      fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`
    );
  };

  const openEdit = (row: TransactionRow) => {
    setEditing(row);
    setFormOpen(true);
  };
  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const handleSubmit = async (data: TransactionFormData) => {
    if (editing) await onUpdate(editing.client_uuid, data);
    else await onCreate(data);
  };

  const handleDelete = async (row: TransactionRow) => {
    if (window.confirm(t(lang, "confirmDelete"))) await onDelete(row.client_uuid);
  };

  const resetFilters = () => {
    setSearch("");
    setTypeFilter("all");
    setCatFilter("all");
    setFromDate("");
    setToDate("");
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(lang, "searchPlaceholder")} className="input pl-10" />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters((v) => !v)} className="btn-secondary">
            <Filter size={16} />
            {t(lang, "filter")}
          </button>
          {showTotals && (
            <button onClick={handleExport} className="btn-secondary" disabled={filtered.length === 0}>
              <Download size={16} />
              <span className="hidden sm:inline">{t(lang, "exportExcel")}</span>
            </button>
          )}
          <button onClick={openCreate} className="btn-primary">
            <Plus size={16} />
            <span className="hidden sm:inline">{t(lang, "addTransaction")}</span>
          </button>
        </div>
      </div>

      {showFilters && (
        <div className="card animate-fade-up flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="input-label">{t(lang, "type")}</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as FilterType)} className="input min-w-[160px]">
              <option value="all">{t(lang, "allTypes")}</option>
              <option value="miditra">{t(lang, "miditra")}</option>
              <option value="mivoaka">{t(lang, "mivoaka")}</option>
            </select>
          </div>
          <div>
            <label className="input-label">{t(lang, "category")}</label>
            <select value={catFilter} onChange={(e) => setCatFilter(e.target.value)} className="input min-w-[160px]">
              <option value="all">{t(lang, "allCategories")}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.nom}>{categoryLabel(lang, c.nom)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="input-label">{t(lang, "from")}</label>
            <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="input" />
          </div>
          <div>
            <label className="input-label">{t(lang, "to")}</label>
            <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="input" />
          </div>
          <button onClick={resetFilters} className="btn-ghost">{t(lang, "reset")}</button>
        </div>
      )}

      {showTotals && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "totalIncome")}</div>
            <div className="mt-1 text-lg font-bold text-emerald-400">{formatAriary(totals.income, lang)}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "totalExpense")}</div>
            <div className="mt-1 text-lg font-bold text-rose-400">{formatAriary(totals.expense, lang)}</div>
          </div>
          <div className="card p-4">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t(lang, "currentBalance")}</div>
            <div className={`mt-1 text-lg font-bold ${totals.balance >= 0 ? "text-emerald-400 glow-pos" : "text-rose-400 glow-neg"}`}>
              {formatAriary(totals.balance, lang)}
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                <th className="px-4 py-3 font-semibold">{t(lang, "date")}</th>
                <th className="px-4 py-3 font-semibold">{t(lang, "motif")}</th>
                <th className="px-4 py-3 font-semibold">{t(lang, "category")}</th>
                <th className="px-4 py-3 font-semibold">{t(lang, "type")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t(lang, "amount")}</th>
                {showTotals && <th className="px-4 py-3 text-right font-semibold">{t(lang, "balanceAfter")}</th>}
                {showAuthor && <th className="px-4 py-3 font-semibold">{t(lang, "author")}</th>}
                <th className="px-4 py-3 font-semibold">{t(lang, "status")}</th>
                <th className="px-4 py-3 text-right font-semibold">{t(lang, "actions")}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={showAuthor ? 9 : 8} className="px-4 py-12">
                    <div className="flex flex-col items-center gap-2 text-slate-500">
                      <Inbox size={32} className="opacity-40" />
                      <div className="text-sm font-medium">{t(lang, "noTransactions")}</div>
                      <div className="text-xs">{t(lang, "noTransactionsHint")}</div>
                    </div>
                  </td>
                </tr>
              ) : (
                filtered.map((row, i) => (
                  <tr key={`${row.client_uuid}-${i}`} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                    <td className="whitespace-nowrap px-4 py-3 text-slate-300">{formatDate(row.date_transaction, lang)}</td>
                    <td className="px-4 py-3 text-slate-200">{row.motif}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
                        <Tag size={11} />
                        {categoryLabel(lang, row.categorie)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.type_operation === "miditra" ? (
                        <span className="badge-income"><ArrowDownCircle size={12} />{t(lang, "income")}</span>
                      ) : (
                        <span className="badge-expense"><ArrowUpCircle size={12} />{t(lang, "expense")}</span>
                      )}
                    </td>
                    <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${row.type_operation === "miditra" ? "text-emerald-400" : "text-rose-400"}`}>
                      {row.type_operation === "miditra" ? "+" : "-"}{formatAriary(row.montant, lang)}
                    </td>
                    {showTotals && (
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${(withBalance.get(row.client_uuid) ?? 0) >= 0 ? "text-slate-200" : "text-rose-400"}`}>
                        {formatAriary(withBalance.get(row.client_uuid) ?? 0, lang)}
                      </td>
                    )}
                    {showAuthor && <td className="px-4 py-3 text-slate-400">{row.auteur_nom ?? "—"}</td>}
                    <td className="px-4 py-3">
                      {row.statut === "validee" ? (
                        <span className="badge-synced !text-[10px]"><CheckCircle2 size={10} />{t(lang, "statut_validee")}</span>
                      ) : (
                        <span className="badge-pending !text-[10px]"><Clock size={10} />{t(lang, "statut_en_attente")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {row.synced === false && (
                          <span className="badge-pending !px-2 !py-0.5" title={t(lang, "pending")}><Clock size={10} /></span>
                        )}
                        {row.statut === "en_attente_validation" && isAdmin && onValidate && (
                          <button
                            onClick={() => onValidate(row.client_uuid)}
                            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-emerald-500/10 hover:text-emerald-400"
                            title={t(lang, "validate")}
                          >
                            <Check size={15} />
                          </button>
                        )}
                        {canModify(row) ? (
                          <>
                            <button onClick={() => openEdit(row)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-emerald-400" title={t(lang, "edit")} aria-label={t(lang, "edit")}>
                              <Pencil size={15} />
                            </button>
                            <button onClick={() => handleDelete(row)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400" title={t(lang, "delete")} aria-label={t(lang, "delete")}>
                              <Trash2 size={15} />
                            </button>
                          </>
                        ) : (
                          <span className="px-1.5 text-[10px] text-slate-600" title={t(lang, "readOnly")}>{t(lang, "readOnly")}</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > 0 && (
          <div className="border-t border-white/10 px-4 py-2.5 text-xs text-slate-500">{t(lang, "showEntries", { n: filtered.length })}</div>
        )}
      </div>

      <TransactionForm
        lang={lang}
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
        initial={editing ?? undefined}
        mode={editing ? "edit" : "create"}
        categories={categories}
        validationThreshold={validationThreshold}
        isAdmin={isAdmin}
      />
    </div>
  );
}
