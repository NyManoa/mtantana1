// xlsx est chargé à la demande (≈ 400 Ko) pour alléger le premier chargement.
const loadXlsx = () => import("xlsx");
import type { Lang } from "./i18n";
import { t } from "./i18n";

export interface ExportRow {
  date_transaction: string;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
  auteur_nom?: string;
  cree_le: string;
}

/**
 * Export with the exact columns from the guide:
 * Date, Motif, Vola miditra, Vola mivoaka, Solde (running balance).
 * Plus Category and Author columns. Rows sorted ascending by date/creation.
 */
export async function exportTransactionsExcel(rows: ExportRow[], lang: Lang, filename: string) {
  const XLSX = await loadXlsx();
  const sorted = [...rows].sort((a, b) =>
    (a.date_transaction + a.cree_le).localeCompare(b.date_transaction + b.cree_le)
  );

  let running = 0;
  const data = sorted.map((r) => {
    const miditra = r.type_operation === "miditra" ? r.montant : 0;
    const mivoaka = r.type_operation === "mivoaka" ? r.montant : 0;
    running += miditra - mivoaka;
    return {
      [t(lang, "date")]: r.date_transaction,
      [t(lang, "motif")]: r.motif,
      [t(lang, "category")]: t(lang, `cat_${r.categorie}`),
      [t(lang, "miditra")]: miditra,
      [t(lang, "mivoaka")]: mivoaka,
      [t(lang, "currentBalance")]: running,
      [t(lang, "author")]: r.auteur_nom ?? "",
    };
  });

  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 28 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Transactions");
  XLSX.writeFile(wb, filename);
}

export interface ImportRow {
  rowNumber: number;
  dateRaw: string;
  motif: string;
  miditra: number;
  mivoaka: number;
  soldeFile: number;
  dateParsed: string | null;
  status: "valid" | "invalid_date" | "invalid_amount";
  include: boolean;
  type_operation: "miditra" | "mivoaka" | null;
  montant: number | null;
}

function parseDate(raw: unknown): string | null {
  if (!raw && raw !== 0) return null;
  // Excel serial date number (days since 1899-12-30)
  if (typeof raw === "number" && raw > 0 && raw < 100000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const dt = new Date(epoch.getTime() + raw * 86400000);
    if (!isNaN(dt.getTime())) return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  }
  const s = String(raw).trim();
  if (!s) return null;
  // ISO: AAAA-MM-JJ or AAAA/MM/JJ
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  // DD/MM/YYYY or DD-MM-YYYY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // DD.MM.YYYY
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  // MM/DD/YYYY (US format — only if day > 12 would be ambiguous, assume MM/DD)
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const part1 = parseInt(m[1]);
    const part2 = parseInt(m[2]);
    // If first part > 12, it must be DD/MM
    if (part1 > 12 && part2 <= 12) {
      return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
    }
    // Otherwise assume DD/MM (Madagascar/European convention)
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  // YYYYMMDD (compact)
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // DD MMM YYYY (e.g. "15 Jan 2024")
  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    janv: "01", fevr: "02", mars: "03", avr: "04", mai: "05", juin: "06",
    juil: "07", aout: "08", août: "08", sept: "09", déc: "12", dece: "12",
  };
  m = s.match(/^(\d{1,2})\s+([a-zéû]{3,4})\s+(\d{4})$/i);
  if (m) {
    const mo = months[m[2].toLowerCase().slice(0, 4)];
    if (mo) return `${m[3]}-${mo}-${m[1].padStart(2, "0")}`;
  }
  // Try Date parsing as fallback
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return raw;
  const s = String(raw).trim().replace(/\s/g, "").replace(/\u00a0/g, "").replace(/,/g, ".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export function parseImportFile(file: File, callback: (rows: ImportRow[], fileName: string) => void) {
  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const XLSX = await loadXlsx();
      const data = new Uint8Array(e.target?.result as ArrayBuffer);
      const wb = XLSX.read(data, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][];
      if (json.length < 2) {
        callback([], file.name);
        return;
      }
      // Find header row - look for "Date" in first row
      const header = json[0] as string[];
      const dateCol = header.findIndex((h) => String(h).toLowerCase().includes("date"));
      const motifCol = header.findIndex((h) => {
        const l = String(h).toLowerCase();
        return l.includes("motif") || l.includes("description") || l.includes("libelle") || l.includes("libellé");
      });
      // Accept multiple naming conventions for incoming/outgoing columns
      const miditraCol = header.findIndex((h) => {
        const l = String(h).toLowerCase();
        return l.includes("miditra") || l.includes("entrant") || l.includes("entree") || l.includes("entrée") || l.includes("credit") || l.includes("crédit");
      });
      const mivoakaCol = header.findIndex((h) => {
        const l = String(h).toLowerCase();
        return l.includes("mivoaka") || l.includes("sortant") || l.includes("sortie") || l.includes("debit") || l.includes("débit");
      });
      // Solde (running balance) column is optional
      const soldeCol = header.findIndex((h) => String(h).toLowerCase().includes("solde") || String(h).toLowerCase().includes("balance"));
      // Also support a single "Montant" column with a "Type" column
      const montantCol = header.findIndex((h) => {
        const l = String(h).toLowerCase();
        return l === "montant" || l === "montant (ar)" || l.includes("vola") || l === "amount";
      });
      const typeCol = header.findIndex((h) => {
        const l = String(h).toLowerCase();
        return l === "type" || l === "type_operation" || l.includes("operation");
      });

      if (dateCol === -1 || motifCol === -1) {
        callback([], file.name);
        return;
      }
      // Need either separate miditra/mivoaka columns, OR a montant+type column pair
      const hasSeparateCols = miditraCol !== -1 && mivoakaCol !== -1;
      const hasMontantTypeCols = montantCol !== -1 && typeCol !== -1;
      if (!hasSeparateCols && !hasMontantTypeCols) {
        callback([], file.name);
        return;
      }
      const rows: ImportRow[] = [];
      for (let i = 1; i < json.length; i++) {
        const row = json[i] as unknown[];
        if (!row || row.every((c) => c === null || c === undefined || c === "")) continue;
        const dateRaw = String(row[dateCol] ?? "").trim();
        const motif = String(row[motifCol] ?? "").trim();
        const soldeFile = soldeCol !== -1 ? parseAmount(row[soldeCol]) : null;
        const dateParsed = parseDate(row[dateCol]);
        let status: ImportRow["status"] = "valid";
        let type_operation: "miditra" | "mivoaka" | null = null;
        let montant: number | null = null;
        let miditraVal: number | null = null;
        let mivoakaVal: number | null = null;

        if (hasSeparateCols) {
          miditraVal = parseAmount(row[miditraCol]);
          mivoakaVal = parseAmount(row[mivoakaCol]);
          if (!dateParsed) {
            status = "invalid_date";
          } else if ((miditraVal !== null && miditraVal > 0) && (mivoakaVal !== null && mivoakaVal > 0)) {
            status = "invalid_amount";
          } else if ((miditraVal === null || miditraVal === 0) && (mivoakaVal === null || mivoakaVal === 0)) {
            status = "invalid_amount";
          } else {
            if (miditraVal !== null && miditraVal > 0) {
              type_operation = "miditra";
              montant = miditraVal;
            } else if (mivoakaVal !== null && mivoakaVal > 0) {
              type_operation = "mivoaka";
              montant = mivoakaVal;
            } else {
              status = "invalid_amount";
            }
          }
        } else {
          // montant + type columns
          montant = parseAmount(row[montantCol]);
          const typeRaw = String(row[typeCol] ?? "").trim().toLowerCase();
          if (!dateParsed) {
            status = "invalid_date";
          } else if (montant === null || montant === 0) {
            status = "invalid_amount";
          } else if (typeRaw.includes("miditra") || typeRaw.includes("entrant") || typeRaw.includes("entree") || typeRaw.includes("entrée") || typeRaw.includes("credit") || typeRaw.includes("crédit")) {
            type_operation = "miditra";
            miditraVal = montant;
          } else if (typeRaw.includes("mivoaka") || typeRaw.includes("sortant") || typeRaw.includes("sortie") || typeRaw.includes("debit") || typeRaw.includes("débit")) {
            type_operation = "mivoaka";
            mivoakaVal = montant;
          } else {
            status = "invalid_amount";
          }
        }
        rows.push({
          rowNumber: i,
          dateRaw,
          motif,
          miditra: miditraVal ?? 0,
          mivoaka: mivoakaVal ?? 0,
          soldeFile: soldeFile ?? 0,
          dateParsed,
          status,
          include: status === "valid",
          type_operation,
          montant,
        });
      }
      callback(rows, file.name);
    } catch {
      callback([], file.name);
    }
  };
  reader.readAsArrayBuffer(file);
}
