import { useState, type FormEvent } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Wallet, Mail, Lock, ArrowRight, AlertCircle, ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { t, type Lang } from "@/lib/i18n";

interface Props {
  mode: "login" | "signup";
}

export function AuthPage({ mode }: Props) {
  const { signIn, signUp, setLang } = useAuth();
  const navigate = useNavigate();
  const [lang, setLocalLang] = useState<Lang>("fr");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nom, setNom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const switchLang = (l: Lang) => {
    setLocalLang(l);
    setLang(l);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        if (!email || !password) {
          setError(t(lang, "fillAllFields"));
          setLoading(false);
          return;
        }
        const { error: err } = await signIn(email, password);
        if (err) {
          setError(err);
          setLoading(false);
          return;
        }
        navigate("/dashboard");
      } else {
        if (!email || !password || !nom) {
          setError(t(lang, "fillAllFields"));
          setLoading(false);
          return;
        }
        if (password !== confirm) {
          setError(t(lang, "passwordMismatch"));
          setLoading(false);
          return;
        }
        const { error: err } = await signUp(email, password, nom);
        if (err) {
          setError(err);
          setLoading(false);
          return;
        }
        navigate("/dashboard");
      }
    } catch {
      setError(t(lang, "error"));
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-[#0b1220] p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-cyan-500/20 blur-3xl" />

      <div className="absolute right-5 top-5 flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
        {(["fr", "mg"] as Lang[]).map((l) => (
          <button
            key={l}
            onClick={() => switchLang(l)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${lang === l ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-white"}`}
          >
            {l.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 shadow-2xl shadow-emerald-500/30">
            <Wallet size={32} className="text-emerald-950" />
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            <span className="text-gradient">M'tantana</span>
          </h1>
          <p className="mt-1.5 text-sm text-slate-400">
            {mode === "login" ? t(lang, "loginSubtitle") : t(lang, "appTagline")}
          </p>
        </div>

        <div className="card p-7">
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="input-label">{t(lang, "nom")}</label>
                <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} className="input" placeholder={t(lang, "nom")} />
              </div>
            )}
            <div>
              <label className="input-label">{t(lang, "email")}</label>
              <div className="relative">
                <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="input pl-10" placeholder={t(lang, "email")} />
              </div>
            </div>
            <div>
              <label className="input-label">{t(lang, "password")}</label>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="input pl-10" placeholder={t(lang, "password")} />
              </div>
            </div>
            {mode === "signup" && (
              <div>
                <label className="input-label">{t(lang, "confirmPassword")}</label>
                <div className="relative">
                  <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="input pl-10" placeholder={t(lang, "confirmPassword")} />
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
                <AlertCircle size={16} />{error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? t(lang, "loading") : (<>{mode === "login" ? t(lang, "signIn") : t(lang, "signUp")}<ArrowRight size={16} /></>)}
            </button>
          </form>
          <div className="mt-5 text-center text-sm text-slate-400">
            {mode === "login" ? t(lang, "noAccount") : t(lang, "haveAccount")}{" "}
            <Link to={mode === "login" ? "/signup" : "/login"} className="font-semibold text-emerald-400 transition hover:text-emerald-300">
              {mode === "login" ? t(lang, "signUp") : t(lang, "signIn")}
            </Link>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-500">
          <span>{t(lang, "developerCredit")}</span>
          <a href="https://nymanoa.netlify.app" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-slate-400 transition hover:text-emerald-400">
            {t(lang, "developerName")}<ExternalLink size={11} />
          </a>
        </div>
      </div>
    </div>
  );
}
