import type { Lang } from "./i18n";
export { todayISO } from "./db";

const locale = (lang: Lang) => (lang === "mg" ? "mg-MG" : "fr-FR");

export function formatAriary(amount: number, _lang: Lang = "fr"): string {
  void _lang;
  const formatted = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Math.abs(amount));
  return `${amount < 0 ? "-" : ""}${formatted} Ar`;
}

/** Interprète « AAAA-MM-JJ » comme une date LOCALE (et non UTC minuit). */
function parse(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(iso);
}

export function formatDate(iso: string, _lang: Lang = "fr"): string {
  void _lang;
  const d = parse(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatDateTime(iso: string, _lang: Lang = "fr"): string {
  void _lang;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonthYear(): string {
  return monthKey(new Date());
}

export function previousMonthYear(monthYear: string): string {
  const [y, m] = monthYear.split("-").map(Number);
  return monthKey(new Date(y, m - 2, 1));
}

/** Les `n` derniers mois (du plus ancien au plus récent), au format AAAA-MM. */
export function lastMonths(n: number): string[] {
  const now = new Date();
  return Array.from({ length: n }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() - (n - 1 - i), 1)));
}

export function monthLabel(monthYear: string, lang: Lang = "fr"): string {
  const [y, m] = monthYear.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  try {
    return d.toLocaleDateString(locale(lang), { month: "short", year: "numeric" });
  } catch {
    return d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
  }
}

/** Nombre de jours entre aujourd'hui et une date AAAA-MM-JJ (négatif si passée). */
export function daysUntil(iso: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((parse(iso).getTime() - today.getTime()) / 86_400_000);
}
