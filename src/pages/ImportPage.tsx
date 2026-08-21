import { useState, useRef } from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, Inbox, Download } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { db, genClientUuid } from "@/lib/db";
import { parseImportFile, type ImportRow } from "@/lib/excel";
import { t } from "@/lib/i18n";
import { formatAriary } from "@/lib/format";
import { useToast } from "@/components/Toast";

export function ImportPage() {
  const { profile, lang } = useAuth();
  const { currentEspace } = useEspace();
  const { show: showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!profile) return null;

  const handleFile = (file: File) => {
    setError(null);
    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      setError(t(lang, "importInvalidFile"));
      return;
    }
    parseImportFile(file, (parsed, name) => {
      if (parsed.length === 0) {
        setError(t(lang, "importInvalidFile"));
        return;
      }
      setRows(parsed);
      setFileName(name);
    });
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const toggleRow = (idx: number) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, include: !r.include } : r)));
  };

  const validCount = rows.filter((r) => r.status === "valid" && r.include).length;
  const errorCount = rows.filter((r) => r.status !== "valid").length;

  const calculatedSolde = rows
    .filter((r) => r.status === "valid" && r.include)
    .reduce((sum, r) => sum + (r.type_operation === "miditra" ? r.montant! : -r.montant!), 0);
  const fileSolde = rows.length > 0 ? rows[rows.length - 1].soldeFile : 0;
  const soldeMatch = Math.abs(calculatedSolde - fileSolde) < 1;

  const handleImport = async () => {
    if (!profile || !currentEspace) return;
    setImporting(true);
    const toImport = rows.filter((r) => r.status === "valid" && r.include);
    let successCount = 0;
    const now = new Date().toISOString();

    for (const row of toImport) {
      await db.transactions.add({
        client_uuid: genClientUuid(),
        date_transaction: row.dateParsed!,
        motif: row.motif,
        type_operation: row.type_operation!,
        montant: row.montant!,
        categorie: "autre",
        statut: "validee",
        auteur_id: profile.id,
        cree_le: now,
        modifie_le: null,
        supprime: false,
        espace_id: currentEspace.id,
      });
      successCount++;
    }

    await db.journal_audit.add({
      action: "import",
      table_concernee: "transactions",
      enregistrement_id: "import",
      ancienne_valeur: null,
      nouvelle_valeur: JSON.stringify({ fichier: fileName, lignes_importees: successCount, date: now }),
      auteur_id: profile.id,
      date_action: now,
      espace_id: currentEspace.id,
    });

    showToast(t(lang, "importSuccess", { n: successCount }), "success");
    window.dispatchEvent(new CustomEvent("mtantana:reload-transactions"));
    setRows([]);
    setFileName("");
    setImporting(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const reset = () => {
    setRows([]);
    setFileName("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const statusBadge = (status: ImportRow["status"]) => {
    switch (status) {
      case "valid":
        return <span className="badge-synced !text-[10px]"><CheckCircle2 size={10} />{t(lang, "importRowValid")}</span>;
      case "invalid_date":
        return <span className="badge-pending !text-[10px]"><AlertCircle size={10} />{t(lang, "importRowInvalidDate")}</span>;
      case "invalid_amount":
        return <span className="badge-expense !text-[10px]"><AlertCircle size={10} />{t(lang, "importRowMissingAmount")}</span>;
    }
  };

  return (
    <Layout
      title={t(lang, "importExcel")}
      subtitle={t(lang, "importHint")}
      actions={rows.length > 0 ? (
        <div className="flex gap-2">
          <button onClick={reset} className="btn-secondary"><X size={16} />{t(lang, "importCancel")}</button>
          <button onClick={handleImport} disabled={importing || validCount === 0} className="btn-primary">
            {importing ? t(lang, "importProcessing") : <><Download size={16} />{t(lang, "importValidate")} ({validCount})</>}
          </button>
        </div>
      ) : undefined}
    >
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          <AlertCircle size={16} />{error}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`card flex cursor-pointer flex-col items-center gap-4 border-2 border-dashed py-20 transition ${dragOver ? "border-emerald-500/60 bg-emerald-500/5" : "border-white/15 hover:border-white/25"}`}
        >
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
            <Upload size={32} />
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-white">{t(lang, "importDragDrop")}</div>
            <div className="mt-1 text-xs text-slate-500">{t(lang, "importHint")}</div>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFileInput} className="hidden" />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="card p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400">
                <FileSpreadsheet size={18} />
              </div>
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{fileName}</div>
                <div className="text-xs text-slate-500">{t(lang, "importRowCount", { n: rows.length })}</div>
              </div>
              <div className="flex gap-2 text-xs">
                <span className="badge-synced">{t(lang, "importValidCount", { n: validCount })}</span>
                {errorCount > 0 && <span className="badge-expense">{t(lang, "importInvalidCount", { n: errorCount })}</span>}
              </div>
            </div>
            {fileSolde !== 0 && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <div className="text-xs font-semibold text-slate-400">{t(lang, "importSoldeCheck")}</div>
                <div className="mt-1 flex items-center gap-2 text-sm">
                  {soldeMatch ? (
                    <span className="flex items-center gap-1.5 text-emerald-400"><CheckCircle2 size={14} />{t(lang, "importSoldeMatch")}</span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-amber-400">
                      <AlertCircle size={14} />
                      {t(lang, "importSoldeMismatch", { file: formatAriary(fileSolde, lang), calc: formatAriary(calculatedSolde, lang) })}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="card overflow-hidden">
            <div className="max-h-[500px] overflow-auto">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-[#0e1626]">
                  <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-3 font-semibold">{t(lang, "importInclude")}</th>
                    <th className="px-3 py-3 font-semibold">{t(lang, "date")}</th>
                    <th className="px-3 py-3 font-semibold">{t(lang, "motif")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t(lang, "miditra")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t(lang, "mivoaka")}</th>
                    <th className="px-3 py-3 text-right font-semibold">{t(lang, "currentBalance")}</th>
                    <th className="px-3 py-3 font-semibold">{t(lang, "status")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={idx} className={`border-b border-white/5 transition ${row.status !== "valid" ? "bg-rose-500/[0.03]" : row.include ? "" : "opacity-40"}`}>
                      <td className="px-3 py-2.5">
                        {row.status === "valid" && (
                          <button
                            onClick={() => toggleRow(idx)}
                            className={`flex h-5 w-5 items-center justify-center rounded-md border transition ${row.include ? "border-emerald-500/60 bg-emerald-500/20 text-emerald-400" : "border-white/20 text-transparent hover:border-white/40"}`}
                          >
                            <CheckCircle2 size={12} />
                          </button>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-slate-300">{row.dateParsed ?? <span className="text-rose-400">{row.dateRaw}</span>}</td>
                      <td className="px-3 py-2.5 text-slate-200">{row.motif || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-emerald-400">{row.miditra > 0 ? formatAriary(row.miditra, lang) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold text-rose-400">{row.mivoaka > 0 ? formatAriary(row.mivoaka, lang) : "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right text-slate-400">{row.soldeFile !== 0 ? formatAriary(row.soldeFile, lang) : "—"}</td>
                      <td className="px-3 py-2.5">{statusBadge(row.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
