import { useState, type ReactNode } from "react";
import { Building2, Plus, AlertCircle } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { t } from "@/lib/i18n";
import { useToast } from "@/components/Toast";
import { pingCloud } from "@/lib/supabase";

export function EspaceGuard({ children }: { children: ReactNode }) {
  const { profile, lang, loading: authLoading, mode, cloudStatus, signOut } = useAuth();
  const { espaces, loading, createEspace, refresh } = useEspace();
  const { show: showToast } = useToast();
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (authLoading || loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-500" />
      </div>
    );
  }

  if (espaces.length > 0) return <>{children}</>;

  const handleCreate = async () => {
    if (!profile || !newName.trim()) return;
    setCreating(true);
    setError(null);
    const { error: err } = await createEspace(newName.trim());
    if (err) {
      setError(err);
      setCreating(false);
      return;
    }
    setNewName("");
    showToast(t(lang, "espaceCreated"), "success");
    refresh();
    setCreating(false);
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="card p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-400">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-lg font-bold text-white">{t(lang, "noEspaceTitle")}</h2>
          <p className="mt-2 text-sm text-slate-400">{t(lang, "noEspaceMsg")}</p>
          {mode === "cloud" && (cloudStatus !== "ok" || !navigator.onLine) && (
            <div role="status" className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left text-xs text-amber-200">
              <div className="font-semibold">{t(lang, "cloudUnreachableTitle")}</div>
              <div className="mt-1 text-amber-200/80">{t(lang, "noEspaceServerDown")}</div>
              <div className="mt-2 flex gap-3">
                <button type="button" onClick={async () => { await pingCloud(); await refresh(); }} className="font-semibold underline underline-offset-2">{t(lang, "retry")}</button>
                <button type="button" onClick={() => signOut()} className="font-semibold underline underline-offset-2">{t(lang, "useWithoutAccount")}</button>
              </div>
            </div>
          )}

          <div className="mt-6 space-y-3">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5">
              <Building2 size={16} className="text-emerald-400" />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t(lang, "espaceName")}
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-600 focus:outline-none"
                autoFocus
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
            </div>
            {error && <div className="text-xs text-rose-400">{error}</div>}
            <button
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
              className="btn-primary w-full"
            >
              {creating ? (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              ) : (
                <>
                  <Plus size={16} />
                  {t(lang, "createFirstEspace")}
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
