import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Users as UsersIcon, Plus, Pencil, ShieldCheck, ShieldX, X, Mail, User, AlertCircle, UserMinus, WifiOff, RefreshCw, Clock, Link2, Trash2 } from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useSync } from "@/lib/sync";
import { useToast } from "@/components/Toast";
import { supabase } from "@/lib/supabase";
import { t, type Lang } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import type { Role } from "@/lib/db";

interface Member {
  id: string;
  nom: string;
  email: string;
  role: Role;
  langue: Lang;
  actif: boolean;
  cree_le: string;
}

interface Invitation {
  id: string;
  email: string;
  role: Role;
  cree_le: string;
}

const ROLE_ORDER: Role[] = ["operateur", "superviseur", "admin"];
const roleLabelKey = (r: Role) => (r === "operateur" ? "operator" : r);
const roleDescKey = (r: Role) => (r === "operateur" ? "roleOperatorDesc" : r === "superviseur" ? "roleSuperviseurDesc" : "roleAdminDesc");

function RolePicker({ value, onChange, lang }: { value: Role; onChange: (r: Role) => void; lang: Lang }) {
  return (
    <fieldset>
      <legend className="input-label">{t(lang, "roleInEspace")}</legend>
      <div className="space-y-2">
        {ROLE_ORDER.map((r) => (
          <label
            key={r}
            className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition ${value === r ? "border-emerald-500/60 bg-emerald-500/10" : "border-white/10 bg-white/5 hover:border-white/20"}`}
          >
            <input type="radio" name="role" value={r} checked={value === r} onChange={() => onChange(r)} className="mt-1 accent-emerald-500" />
            <span>
              <span className="block text-sm font-semibold text-white">{t(lang, roleLabelKey(r))}</span>
              <span className="block text-xs text-slate-400">{t(lang, roleDescKey(r))}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

async function callAdmin<T>(method: "GET" | "POST" | "PUT" | "DELETE", query: Record<string, string>, body?: unknown): Promise<T> {
  const qs = new URLSearchParams(query).toString();
  const { data, error } = await supabase.functions.invoke(`admin-users${qs ? `?${qs}` : ""}`, { method, body: body as Record<string, unknown> | undefined });
  if (error) {
    // L'edge function renvoie { error: "…" } : on remonte ce message lisible.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const payload = await ctx.json().catch(() => null);
      if (payload?.error) throw new Error(payload.error);
    }
    throw new Error(error.message);
  }
  return data as T;
}

function RoleBadge({ role, lang }: { role: Role; lang: Lang }) {
  if (role === "admin") return <span className="badge-admin">{t(lang, "admin")}</span>;
  if (role === "superviseur") return <span className="badge-synced">{t(lang, "superviseur")}</span>;
  return <span className="badge-operator">{t(lang, "operator")}</span>;
}

export function UsersPage() {
  const { lang, profile: me } = useAuth();
  const { currentEspace } = useEspace();
  const { state, sync } = useSync();
  const { show: toast } = useToast();
  const [users, setUsers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<"create" | "edit" | null>(null);
  const [editing, setEditing] = useState<Member | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [fEmail, setFEmail] = useState("");
  const [fNom, setFNom] = useState("");
  const [fRole, setFRole] = useState<Role>("operateur");
  const [fLang, setFLang] = useState<Lang>("fr");
  const [fActif, setFActif] = useState(true);

  const espaceId = currentEspace?.id;

  const load = useCallback(async () => {
    if (!espaceId || !navigator.onLine) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await callAdmin<{ users: Member[]; invitations?: Invitation[] }>("GET", { espace_id: espaceId });
      setUsers(res.users);
      setInvitations(res.invitations ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t(lang, "error"));
    } finally {
      setLoading(false);
    }
  }, [espaceId, lang]);

  useEffect(() => {
    load();
  }, [load, state.online]);

  const openCreate = () => {
    setEditing(null);
    setFEmail("");
    setFRole("operateur");
    setFormError(null);
    setModal("create");
  };

  const openEdit = (u: Member) => {
    setEditing(u);
    setFNom(u.nom);
    setFRole(u.role);
    setFLang(u.langue);
    setFActif(u.actif);
    setFormError(null);
    setModal("edit");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!espaceId) return;
    setSubmitting(true);
    setFormError(null);
    try {
      if (modal === "create") {
        const res = await callAdmin<{ status: "added" | "invited" }>("POST", {}, {
          espace_id: espaceId,
          email: fEmail.trim(),
          role: fRole,
        });
        toast(res.status === "invited" ? t(lang, "invitationSent", { email: fEmail.trim().toLowerCase() }) : t(lang, "memberAdded"), "success");
      } else if (editing) {
        const body: Record<string, unknown> = { espace_id: espaceId, user_id: editing.id };
        if (fRole !== editing.role) body.role = fRole;
        if (fNom.trim() !== editing.nom) body.nom = fNom.trim();
        if (fLang !== editing.langue) body.langue = fLang;
        if (fActif !== editing.actif) body.actif = fActif;
        await callAdmin("PUT", {}, body);
        toast(t(lang, "saved"), "success");
      }
      setModal(null);
      await load();
      sync();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t(lang, "error"));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (u: Member) => {
    if (!espaceId || !window.confirm(t(lang, "confirmRemoveMember"))) return;
    try {
      await callAdmin("DELETE", { espace_id: espaceId, user_id: u.id });
      toast(t(lang, "saved"), "success");
      await load();
      sync();
    } catch (err) {
      toast(err instanceof Error ? err.message : t(lang, "error"), "error");
    }
  };

  const inviteLink = (email: string) => `${window.location.origin}/signup?email=${encodeURIComponent(email)}`;

  const copyInvite = async (inv: Invitation) => {
    const text = t(lang, "inviteMessage", { espace: currentEspace?.nom ?? "", email: inv.email, link: inviteLink(inv.email) });
    try {
      await navigator.clipboard.writeText(text);
      toast(t(lang, "inviteCopied"), "success");
    } catch {
      window.prompt(t(lang, "inviteCopyManual"), text);
    }
  };

  const cancelInvite = async (inv: Invitation) => {
    if (!espaceId || !window.confirm(t(lang, "confirmCancelInvite", { email: inv.email }))) return;
    try {
      await callAdmin("DELETE", { espace_id: espaceId, invitation_id: inv.id });
      toast(t(lang, "saved"), "success");
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : t(lang, "error"), "error");
    }
  };

  const title = currentEspace ? t(lang, "membersOf", { espace: currentEspace.nom }) : t(lang, "users");

  return (
    <Layout
      title={t(lang, "users")}
      subtitle={title}
      actions={
        <button onClick={openCreate} disabled={!state.online} className="btn-primary">
          <Plus size={16} />
          <span className="hidden sm:inline">{t(lang, "inviteMember")}</span>
        </button>
      }
    >
      {!state.online ? (
        <div className="card flex flex-col items-center gap-3 py-16 text-center text-slate-400">
          <WifiOff size={32} className="opacity-50" />
          <p className="text-sm">{t(lang, "adminOnlyOnline")}</p>
        </div>
      ) : (
        <>
          {error && (
            <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
              <AlertCircle size={16} />
              <span className="flex-1">{error}</span>
              <button onClick={load} className="btn-ghost !px-2 !py-1 !text-xs"><RefreshCw size={12} /></button>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20 text-slate-500">{t(lang, "loading")}</div>
          ) : users.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 py-20 text-slate-500">
              <UsersIcon size={36} className="opacity-40" />
              <div className="text-sm font-medium">{t(lang, "noUsers")}</div>
            </div>
          ) : (
            <>
              {/* Mobile : cartes */}
              <div className="space-y-2 md:hidden">
                {users.map((u) => (
                  <div key={u.id} className="card flex items-center gap-3 p-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-sm font-bold text-white">{u.nom.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-white">{u.nom}{u.id === me?.id && <span className="ml-1 text-xs text-slate-500">({t(lang, "you")})</span>}</div>
                      <div className="truncate text-xs text-slate-400">{u.email}</div>
                      <div className="mt-1 flex gap-1.5"><RoleBadge role={u.role} lang={lang} />{!u.actif && <span className="badge-expense">{t(lang, "inactive")}</span>}</div>
                    </div>
                    {u.id !== me?.id && (
                      <div className="flex flex-col gap-1">
                        <button onClick={() => openEdit(u)} className="rounded-lg p-2 text-slate-400 hover:bg-white/10 hover:text-emerald-400" aria-label={t(lang, "edit")}><Pencil size={15} /></button>
                        <button onClick={() => remove(u)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400" aria-label={t(lang, "removeFromEspace")}><UserMinus size={15} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Bureau : tableau */}
              <div className="card hidden overflow-hidden md:block">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                        <th className="px-4 py-3 font-semibold">{t(lang, "nom")}</th>
                        <th className="px-4 py-3 font-semibold">{t(lang, "email")}</th>
                        <th className="px-4 py-3 font-semibold">{t(lang, "roleInEspace")}</th>
                        <th className="px-4 py-3 font-semibold">{t(lang, "status")}</th>
                        <th className="px-4 py-3 font-semibold">{t(lang, "createdOn")}</th>
                        <th className="px-4 py-3 text-right font-semibold">{t(lang, "actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-xs font-bold text-white">{u.nom.charAt(0).toUpperCase()}</div>
                              <span className="font-medium text-slate-200">{u.nom}</span>
                              {u.id === me?.id && <span className="text-xs text-slate-500">({t(lang, "you")})</span>}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-400">{u.email}</td>
                          <td className="px-4 py-3"><RoleBadge role={u.role} lang={lang} /></td>
                          <td className="px-4 py-3">{u.actif ? <span className="badge-synced">{t(lang, "active")}</span> : <span className="badge-expense">{t(lang, "inactive")}</span>}</td>
                          <td className="px-4 py-3 text-slate-400">{formatDateTime(u.cree_le, lang)}</td>
                          <td className="px-4 py-3 text-right">
                            {u.id !== me?.id && (
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => openEdit(u)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-emerald-400" title={t(lang, "edit")} aria-label={t(lang, "edit")}><Pencil size={15} /></button>
                                <button onClick={() => remove(u)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400" title={t(lang, "removeFromEspace")} aria-label={t(lang, "removeFromEspace")}><UserMinus size={15} /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {!loading && invitations.length > 0 && (
            <section className="mt-6" aria-labelledby="inv-title">
              <h2 id="inv-title" className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
                <Clock size={15} className="text-amber-400" />
                {t(lang, "pendingInvitations")} ({invitations.length})
              </h2>
              <p className="mb-3 text-xs text-slate-500">{t(lang, "pendingInvitationsHint")}</p>
              <div className="space-y-2">
                {invitations.map((inv) => (
                  <div key={inv.id} className="card flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-300"><Mail size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-200">{inv.email}</div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                        <RoleBadge role={inv.role} lang={lang} />
                        <span>{formatDateTime(inv.cree_le, lang)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => copyInvite(inv)} className="btn-secondary !px-3 !py-1.5 !text-xs"><Link2 size={13} />{t(lang, "copyInvite")}</button>
                      <button onClick={() => cancelInvite(inv)} className="rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400" aria-label={t(lang, "cancelInvite")} title={t(lang, "cancelInvite")}><Trash2 size={15} /></button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModal(null)} />
          <div className="card relative z-10 max-h-[90vh] w-full max-w-md animate-fade-up overflow-y-auto p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">{modal === "edit" ? t(lang, "editUser") : t(lang, "inviteMember")}</h2>
              <button onClick={() => setModal(null)} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label={t(lang, "close")}><X size={18} /></button>
            </div>

            <form onSubmit={submit} className="space-y-4">
              {modal === "create" ? (
                <>
                  <p className="text-xs text-slate-400">{t(lang, "inviteHint")}</p>
                  <div>
                    <label htmlFor="m-email" className="input-label">{t(lang, "email")}</label>
                    <div className="relative">
                      <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input id="m-email" type="email" inputMode="email" value={fEmail} onChange={(e) => setFEmail(e.target.value)} className="input pl-10" placeholder="nom@gmail.com" required autoComplete="off" autoFocus />
                    </div>
                  </div>
                  <RolePicker value={fRole} onChange={setFRole} lang={lang} />
                </>
              ) : (
                <>
                  <div>
                    <label htmlFor="m-nom" className="input-label">{t(lang, "nom")}</label>
                    <div className="relative">
                      <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input id="m-nom" type="text" value={fNom} onChange={(e) => setFNom(e.target.value)} className="input pl-10" maxLength={100} />
                    </div>
                  </div>
                  <RolePicker value={fRole} onChange={setFRole} lang={lang} />
                  <div>
                    <label htmlFor="m-lang" className="input-label">{t(lang, "language")}</label>
                    <select id="m-lang" value={fLang} onChange={(e) => setFLang(e.target.value as Lang)} className="input">
                      <option value="fr">{t(lang, "french")}</option>
                      <option value="mg">{t(lang, "malagasy")}</option>
                    </select>
                  </div>
                </>
              )}

              {modal === "edit" && (
                <div>
                  <span className="input-label">{t(lang, "status")}</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setFActif(true)} aria-pressed={fActif} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${fActif ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-400"}`}>
                      <ShieldCheck size={16} />{t(lang, "active")}
                    </button>
                    <button type="button" onClick={() => setFActif(false)} aria-pressed={!fActif} className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${!fActif ? "border-rose-500/60 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/5 text-slate-400"}`}>
                      <ShieldX size={16} />{t(lang, "inactive")}
                    </button>
                  </div>
                </div>
              )}

              {formError && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />{formError}
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModal(null)} className="btn-secondary flex-1">{t(lang, "cancel")}</button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1">{submitting ? t(lang, "loading") : modal === "create" ? t(lang, "invite") : t(lang, "save")}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
