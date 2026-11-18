import { useState } from "react";
import { Lock, Eye, EyeOff } from "lucide-react";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { t, type Lang } from "@/lib/i18n";

function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= MIN_PASSWORD_LENGTH) score++;
  if (pw.length >= 12) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (pw.length < MIN_PASSWORD_LENGTH) return 1;
  return score >= 4 ? 3 : score >= 3 ? 2 : 1;
}

export function PasswordInput({
  value,
  onChange,
  lang,
  placeholder,
  autoComplete,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  lang: Lang;
  placeholder?: string;
  autoComplete: string;
  id?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
      <input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input pl-10 pr-11"
        placeholder={placeholder}
        autoComplete={autoComplete}
        required
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-slate-500 transition hover:text-slate-200"
        aria-label={visible ? t(lang, "hidePassword") : t(lang, "showPassword")}
        title={visible ? t(lang, "hidePassword") : t(lang, "showPassword")}
      >
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export function StrengthMeter({ password, lang }: { password: string; lang: Lang }) {
  const s = passwordStrength(password);
  if (!password) return <p className="mt-1.5 text-xs text-slate-500">{t(lang, "passwordHint")}</p>;
  const colors = ["", "bg-rose-500", "bg-amber-400", "bg-emerald-400"];
  const labels = ["", t(lang, "strengthWeak"), t(lang, "strengthMedium"), t(lang, "strengthStrong")];
  return (
    <div className="mt-2" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className={`h-1 flex-1 rounded-full ${i <= s ? colors[s] : "bg-white/10"}`} />
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {labels[s]}
        {password.length < MIN_PASSWORD_LENGTH ? ` · ${t(lang, "passwordHint")}` : ""}
      </p>
    </div>
  );
}

