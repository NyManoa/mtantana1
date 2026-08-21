import type { Lang } from "./i18n";

export function formatAriary(amount: number, lang: Lang = "fr"): string {
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(abs);
  const sign = amount < 0 ? "-" : "";
  return `${sign}${formatted} Ar`;
}

export function formatDate(iso: string, lang: Lang = "fr"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(iso: string, lang: Lang = "fr"): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function currentMonthYear(): string {
  return new Date().toISOString().slice(0, 7);
}

export function monthLabel(monthYear: string, lang: Lang = "fr"): string {
  const [y, m] = monthYear.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString("fr-FR", { month: "short", year: "numeric" });
}

export function previousMonthYear(monthYear: string): string {
  const [y, m] = monthYear.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return d.toISOString().slice(0, 7);
}
