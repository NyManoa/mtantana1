import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Wallet, Mail, ArrowRight, AlertCircle, ExternalLink, User, WifiOff, CheckCircle2, MailCheck } from "lucide-react";
import { PasswordInput, StrengthMeter } from "@/components/PasswordFields";
import { useAuth, googleLoginEnabled, MIN_PASSWORD_LENGTH } from "@/lib/auth";
import { t, type Lang } from "@/lib/i18n";
import { cloudDiagnostic, pingCloud } from "@/lib/supabase";

interface Props {
  mode: "login" | "signup" | "forgot";
}

function AuthShell({ lang, onLang, subtitle, children }: { lang: Lang; onLang: (l: Lang) => void; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0b1220] p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />

      <div className="absolute right-5 top-5 flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1" role="group" aria-label="Langue">
        {(["fr", "mg"] as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => onLang(l)}
            aria-pressed={lang === l}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${lang === l ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-white"}`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <main className="relative z-10 w-full max-w-md animate-fade-up">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-2xl shadow-emerald-500/30">
            <Wallet size={32} className="text-emerald-950" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            <span className="text-gradient">M'tantana</span>
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">{subtitle}</p>
        </div>
        {children}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <span>{t(lang, "developerCredit")}</span>
          <a href="https://nymanoa.netlify.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-slate-400 transition hover:text-emerald-400">
            {t(lang, "developerName")}
            <ExternalLink size={11} />
          </a>
        </div>
      </main>
    </div>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      {message}
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function AuthPage({ mode }: Props) {
  const { signIn, signUp, signInWithGoogle, sendPasswordReset, enterLocalMode, lang, setLang, cloudStatus } = useAuth();
  const navigate = useNavigate();
  // Lien d'invitation : /signup?email=… pré-remplit l'adresse invitée.
  const [email, setEmail] = useState(() => (new URLSearchParams(window.location.search).get("email") ?? "").slice(0, 254));
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nom, setNom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [localOpen, setLocalOpen] = useState(cloudStatus === "unconfigured");

  // Vérifie tout de suite si le serveur répond, pour prévenir avant la saisie.
  useEffect(() => {
    if (cloudStatus !== "unconfigured") pingCloud();
  }, [cloudStatus]);
  const [localName, setLocalName] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "forgot") {
        const { error: err } = await sendPasswordReset(email);
        if (err) setError(err);
        else setInfo(t(lang, "resetLinkSent"));
        return;
      }
      if (mode === "login") {
        const { error: err } = await signIn(email, password);
        if (err) setError(err);
        else navigate("/", { replace: true });
        return;
      }
      if (!nom.trim()) return setError(t(lang, "fillAllFields"));
      if (password.length < MIN_PASSWORD_LENGTH) return setError(t(lang, "passwordHint"));
      if (password !== confirm) return setError(t(lang, "passwordMismatch"));
      const res = await signUp(email, password, nom);
      if (res.error) setError(res.error);
      else if (res.needsConfirmation) setInfo(t(lang, "emailConfirmationRequired"));
      else navigate("/", { replace: true });
    } catch {
      setError(t(lang, "error"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    const { error: err } = await signInWithGoogle();
    if (err) setError(err);
  };

  const handleLocal = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await enterLocalMode(localName);
    setLoading(false);
    navigate("/", { replace: true });
  };

  const subtitle = mode === "login" ? t(lang, "loginSubtitle") : mode === "forgot" ? t(lang, "forgotTitle") : t(lang, "appTagline");

  if (info && mode === "signup") {
    return (
      <AuthShell lang={lang} onLang={setLang} subtitle={subtitle}>
        <div className="card p-7 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <MailCheck size={28} />
          </div>
          <h2 className="text-lg font-bold text-white">{t(lang, "checkEmailTitle")}</h2>
          <p className="mt-2 text-sm text-slate-400">{info}</p>
          <p className="mt-1 text-sm font-semibold text-slate-200">{email}</p>
          <Link to="/login" className="btn-primary mt-6 w-full">{t(lang, "backToLogin")}</Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell lang={lang} onLang={setLang} subtitle={subtitle}>
      {cloudStatus !== "ok" && (
        <div role="status" className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
          <AlertCircle size={18} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">{t(lang, cloudStatus === "unconfigured" ? "cloudUnconfiguredTitle" : "cloudUnreachableTitle")}</div>
            <div className="mt-1 text-amber-200/80">{t(lang, cloudStatus === "unconfigured" ? "cloudUnconfiguredHint" : "cloudUnreachableHint")}</div>
            {cloudStatus === "unreachable" && (
              <div className="mt-2 break-all font-mono text-[11px] text-amber-200/60">{cloudDiagnostic()}</div>
            )}
            {cloudStatus === "unreachable" && (
              <button type="button" onClick={() => pingCloud()} className="mt-2 text-xs font-semibold text-amber-100 underline underline-offset-2">
                {t(lang, "retry")}
              </button>
            )}
          </div>
        </div>
      )}
      <div className="card p-7">
        {mode === "forgot" && <p className="mb-4 text-sm text-slate-400">{t(lang, "forgotHint")}</p>}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate={false}>
          {mode === "signup" && (
            <div>
              <label htmlFor="nom" className="input-label">{t(lang, "nom")}</label>
              <div className="relative">
                <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input id="nom" type="text" value={nom} onChange={(e) => setNom(e.target.value)} className="input pl-10" placeholder={t(lang, "nom")} autoComplete="name" maxLength={100} required />
              </div>
            </div>
          )}
          <div>
            <label htmlFor="email" className="input-label">{t(lang, "email")}</label>
            <div className="relative">
              <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input id="email" type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input pl-10" placeholder="nom@exemple.com" autoComplete="email" required />
            </div>
          </div>

          {mode !== "forgot" && (
            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="input-label">{t(lang, "password")}</label>
                {mode === "login" && (
                  <Link to="/forgot-password" className="mb-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300">
                    {t(lang, "forgotPassword")}
                  </Link>
                )}
              </div>
              <PasswordInput id="password" value={password} onChange={setPassword} lang={lang} placeholder={t(lang, "password")} autoComplete={mode === "login" ? "current-password" : "new-password"} />
              {mode === "signup" && <StrengthMeter password={password} lang={lang} />}
            </div>
          )}

          {mode === "signup" && (
            <div>
              <label htmlFor="confirm" className="input-label">{t(lang, "confirmPassword")}</label>
              <PasswordInput id="confirm" value={confirm} onChange={setConfirm} lang={lang} placeholder={t(lang, "confirmPassword")} autoComplete="new-password" />
            </div>
          )}

          {error && <ErrorBox message={error} />}
          {info && (
            <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
              {info}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? (
              t(lang, "loading")
            ) : (
              <>
                {mode === "login" ? t(lang, "signIn") : mode === "signup" ? t(lang, "signUp") : t(lang, "sendResetLink")}
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        {mode !== "forgot" && googleLoginEnabled && (
          <>
            <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
              <div className="h-px flex-1 bg-white/10" />
              {t(lang, "or")}
              <div className="h-px flex-1 bg-white/10" />
            </div>
            <button type="button" onClick={handleGoogle} className="btn-secondary w-full">
              <GoogleIcon />
              {t(lang, "continueWithGoogle")}
            </button>
          </>
        )}

        <div className="mt-5 text-center text-sm text-slate-400">
          {mode === "forgot" ? (
            <Link to="/login" className="font-semibold text-emerald-400 transition hover:text-emerald-300">{t(lang, "backToLogin")}</Link>
          ) : (
            <>
              {mode === "login" ? t(lang, "noAccount") : t(lang, "haveAccount")}{" "}
              <Link to={mode === "login" ? "/signup" : "/login"} className="font-semibold text-emerald-400 transition hover:text-emerald-300">
                {mode === "login" ? t(lang, "signUp") : t(lang, "signIn")}
              </Link>
            </>
          )}
        </div>
      </div>

      {mode !== "forgot" && (
        <div className="card mt-4 p-5">
          {!localOpen ? (
            <button type="button" onClick={() => setLocalOpen(true)} className="flex w-full items-start gap-3 text-left">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-300">
                <WifiOff size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">{t(lang, "useWithoutAccount")}</div>
                <div className="mt-0.5 text-xs text-slate-400">{t(lang, "useWithoutAccountHint")}</div>
              </div>
            </button>
          ) : (
            <form onSubmit={handleLocal} className="space-y-3">
              <label htmlFor="localName" className="input-label">{t(lang, "yourName")}</label>
              <input id="localName" type="text" value={localName} onChange={(e) => setLocalName(e.target.value)} className="input" placeholder={t(lang, "yourName")} maxLength={100} autoFocus />
              <p className="text-xs text-slate-500">{t(lang, "useWithoutAccountHint")}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setLocalOpen(false)} className="btn-secondary flex-1">{t(lang, "cancel")}</button>
                <button type="submit" disabled={loading} className="btn-primary flex-1">{t(lang, "start")}</button>
              </div>
            </form>
          )}
        </div>
      )}
    </AuthShell>
  );
}
