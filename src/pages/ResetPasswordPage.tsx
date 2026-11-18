import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { PasswordInput, StrengthMeter } from "@/components/PasswordFields";

/** Page atteinte depuis le lien « mot de passe oublié » reçu par e-mail. */
export function ResetPasswordPage() {
  const { recovery, session, loading, updatePassword, lang } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) return setError(t(lang, "passwordMismatch"));
    setSaving(true);
    const { error: err } = await updatePassword(password);
    setSaving(false);
    if (err) setError(err);
    else {
      setDone(true);
      setTimeout(() => navigate("/", { replace: true }), 1500);
    }
  };

  const invalidLink = !loading && !recovery && !done;

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b1220] p-4">
      <main className="card w-full max-w-md p-7">
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <KeyRound size={20} />
          </div>
          <h1 className="text-lg font-bold text-white">{t(lang, "newPasswordTitle")}</h1>
        </div>

        {invalidLink ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">
              {session ? t(lang, "passwordUpdated") : "Ce lien est invalide ou a expiré. Demandez un nouveau lien."}
            </p>
            <Link to={session ? "/" : "/forgot-password"} className="btn-primary w-full">
              {session ? "OK" : t(lang, "sendResetLink")}
            </Link>
          </div>
        ) : done ? (
          <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-300">
            <CheckCircle2 size={16} />
            {t(lang, "passwordUpdated")}
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label htmlFor="np" className="input-label">{t(lang, "newPassword")}</label>
              <PasswordInput id="np" value={password} onChange={setPassword} lang={lang} autoComplete="new-password" />
              <StrengthMeter password={password} lang={lang} />
            </div>
            <div>
              <label htmlFor="npc" className="input-label">{t(lang, "confirmPassword")}</label>
              <PasswordInput id="npc" value={confirm} onChange={setConfirm} lang={lang} autoComplete="new-password" />
            </div>
            {error && (
              <div role="alert" className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            <button type="submit" disabled={saving || loading} className="btn-primary w-full">
              {saving ? t(lang, "loading") : t(lang, "update")}
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
