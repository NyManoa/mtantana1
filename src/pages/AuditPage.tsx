import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollText, Plus, Pencil, Trash2, Inbox, Search, Filter, Download } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { db } from "@/lib/db";
import { supabase } from "@/lib/supabase";
import { t } from "@/lib/i18n";
import { formatAriary, formatDateTime } from "@/lib/format";

interface AuditEntry {
  id: number;
  enregistrement_id: string;
  auteur_id: string;
  action: "creation" | "modification" | "suppression" | "validation" | "import";
  ancienne_valeur: string | null;
  nouvelle_valeur: string | null;
  date_action: string;
  auteur_nom?: string;
}

export function AuditPage() {
  const { lang } = useAuth();
  const { currentEspace } = useEspace();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [allUsers, setAllUsers] = useState<{ id: string; nom: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");
  const [userFilter, setUserFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    if (!currentEspace) { setLoading(false); return; }

    let rows: import("@/lib/db").LocalAudit[];
    rows = await db.journal_audit.where("espace_id").equals(currentEspace.id).reverse().sortBy("date_action");

    if (navigator.onLine) {
      try {
        const { data: cloudAudit, error } = await supabase
          .from("journal_audit")
          .select("id, action, table_concernee, enregistrement_id, ancienne_valeur, nouvelle_valeur, auteur_id, date_action, espace_id")
          .eq("espace_id", currentEspace.id)
          .order("date_action", { ascending: false })
          .limit(500);

        if (!error && cloudAudit) {
          for (const a of cloudAudit) {
            const existing = await db.journal_audit
              .where("espace_id").equals(currentEspace.id)
              .and((row) => row.enregistrement_id === a.enregistrement_id && row.date_action === a.date_action)
              .first();
            if (!existing) {
              await db.journal_audit.add({
                action: a.action,
                table_concernee: a.table_concernee,
                enregistrement_id: a.enregistrement_id,
                ancienne_valeur: a.ancienne_valeur,
                nouvelle_valeur: a.nouvelle_valeur,
                auteur_id: a.auteur_id,
                date_action: a.date_action,
                espace_id: a.espace_id,
              });
            }
          }
          rows = await db.journal_audit.where("espace_id").equals(currentEspace.id).reverse().sortBy("date_action");
        }
      } catch {
        // fall back to local only
      }
    }

    const users = await db.users.toArray();
    const profileMap = new Map<string, string>();
    for (const u of users) profileMap.set(u.id, u.nom);
    setAllUsers(users.map(u => ({ id: u.id, nom: u.nom })));
    setEntries(rows.slice(0, 500).map(r => ({
      id: r.id!,
      enregistrement_id: r.enregistrement_id,
      auteur_id: r.auteur_id,
      action: r.action as AuditEntry["action"],
      ancienne_valeur: r.ancienne_valeur,
      nouvelle_valeur: r.nouvelle_valeur,
      date_action: r.date_action,
      auteur_nom: profileMap.get(r.auteur_id),
    })));
    setLoading(false);
  }, [currentEspace]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (actionFilter !== "all" && e.action !== actionFilter) return false;
      if (userFilter !== "all" && e.auteur_id !== userFilter) return false;
      if (fromDate && e.date_action < fromDate) return false;
      if (toDate && e.date_action > toDate + "T23:59:59") return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${e.auteur_nom ?? ""} ${e.action}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [entries, search, actionFilter, userFilter, fromDate, toDate]);

  const actionStyle = (action: AuditEntry["action"]) => {
    switch (action) {
      case "creation": return { icon: Plus, cls: "text-emerald-400 bg-emerald-500/15", label: t(lang, "creation") };
      case "modification": return { icon: Pencil, cls: "text-sky-400 bg-sky-500/15", label: t(lang, "modification") };
      case "suppression": return { icon: Trash2, cls: "text-rose-400 bg-rose-500/15", label: t(lang, "suppression") };
      case "validation": return { icon: ScrollText, cls: "text-amber-400 bg-amber-500/15", label: t(lang, "validation") };
      case "import": return { icon: Download, cls: "text-sky-400 bg-sky-500/15", label: t(lang, "importExcel") };
      default: return { icon: ScrollText, cls: "text-slate-400 bg-white/5", label: action };
    }
  };

  const renderValue = (val: string | null) => {
    if (!val) return "—";
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(val); } catch { return <div className="text-xs text-slate-300">{val}</div>; }
    if (!parsed) return "—";
    const montant = parsed.montant as number | undefined;
    const type = parsed.type_operation as string | undefined;
    const motif = parsed.motif as string | undefined;
    const date = parsed.date_transaction as string | undefined;
    const cat = parsed.categorie as string | undefined;
    const statut = parsed.statut as string | undefined;
    return (
      <div className="space-y-0.5 text-xs">
        {motif && <div className="text-slate-200">{motif}</div>}
        {date && <div className="text-slate-500">{date}</div>}
        {cat && <div className="text-slate-500">{t(lang, `cat_${cat}`)}</div>}
        {type && <div className={type === "miditra" ? "text-emerald-400" : "text-rose-400"}>{t(lang, type)}</div>}
        {statut && <div className="text-slate-500">{statut === "validee" ? t(lang, "statut_validee") : t(lang, "statut_en_attente")}</div>}
        {montant !== undefined && <div className="font-semibold text-slate-300">{formatAriary(Number(montant), lang)}</div>}
      </div>
    );
  };

  return (
    <Layout title={t(lang, "auditLog")} subtitle={t(lang, "auditLog")}>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(lang, "searchPlaceholder")} className="input pl-10" />
        </div>
        <button onClick={() => setShowFilters((v) => !v)} className="btn-secondary"><Filter size={16} />{t(lang, "filter")}</button>
      </div>

      {showFilters && (
        <div className="card animate-fade-up mb-4 flex flex-wrap items-end gap-3 p-4">
          <div>
            <label className="input-label">{t(lang, "action")}</label>
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="input min-w-[160px]">
              <option value="all">{t(lang, "allActions")}</option>
              <option value="creation">{t(lang, "creation")}</option>
              <option value="modification">{t(lang, "modification")}</option>
              <option value="suppression">{t(lang, "suppression")}</option>
              <option value="validation">{t(lang, "validation")}</option>
            </select>
          </div>
          <div>
            <label className="input-label">{t(lang, "author")}</label>
            <select value={userFilter} onChange={(e) => setUserFilter(e.target.value)} className="input min-w-[160px]">
              <option value="all">{t(lang, "allUsers")}</option>
              {allUsers.map((u) => <option key={u.id} value={u.id}>{u.nom}</option>)}
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
          <button onClick={() => { setSearch(""); setActionFilter("all"); setUserFilter("all"); setFromDate(""); setToDate(""); }} className="btn-ghost">{t(lang, "reset")}</button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-500">{t(lang, "loading")}</div>
      ) : filtered.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 py-20 text-slate-500">
          <Inbox size={36} className="opacity-40" />
          <div className="text-sm font-medium">{t(lang, "noAudit")}</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((entry) => {
            const a = actionStyle(entry.action);
            const ActionIcon = a.icon;
            return (
              <div key={entry.id} className="card animate-fade-up p-4">
                <div className="flex items-start gap-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${a.cls}`}>
                    <ActionIcon size={16} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold text-white">{a.label}</span>
                      <span className="text-xs text-slate-500">{formatDateTime(entry.date_action, lang)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-slate-400">{t(lang, "author")}: {entry.auteur_nom ?? "—"}</div>
                    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{t(lang, "oldValue")}</div>
                        {renderValue(entry.ancienne_valeur)}
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                        <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{t(lang, "newValue")}</div>
                        {renderValue(entry.nouvelle_valeur)}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Layout>
  );
}
