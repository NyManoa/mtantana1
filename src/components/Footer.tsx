import { ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";

export function Footer() {
  const { lang } = useAuth();
  return (
    <footer className="flex items-center justify-center gap-1.5 px-4 py-3 text-xs text-slate-500">
      <span>{t(lang, "developerCredit")}</span>
      <a
        href="https://nymanoa.netlify.app"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 font-semibold text-slate-400 transition hover:text-emerald-400"
      >
        {t(lang, "developerName")}
        <ExternalLink size={11} />
      </a>
    </footer>
  );
}
