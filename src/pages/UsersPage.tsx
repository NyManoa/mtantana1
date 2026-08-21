import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  Users as UsersIcon,
  Plus,
  Pencil,
  ShieldCheck,
  ShieldX,
  X,
  Mail,
  Lock,
  User,
  AlertCircle,
  Trash2,
  CheckCircle2,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth, type UserRole } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { t, type Lang } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";
import { db, genId, type LocalUser } from "@/lib/db";

interface UserRow {
  id: string;
  nom: string;
  email: string;
  role: UserRole;
  langue: Lang;
  actif: boolean;
  cree_le: string;
  espaceIds: string[];
}

export function UsersPage() {
  const { lang, profile: me } = useAuth();
  const { currentEspace, espaces } = useEspace();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UserRow | null>(null);

  const [cEmail, setCEmail] = useState("");
  const [cPassword, setCPassword] = useState("");
  const [cNom, setCNom] = useState("");
  const [cRole, setCRole] = useState<UserRole>("operateur");
  const [cLang, setCLang] = useState<Lang>("fr");
  const [cEspaceIds, setCEspaceIds] = useState<string[]>([]);
  const [eEspaceIds, setEEspaceIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const [eRole, setERole] = useState<UserRole>("operateur");
  const [eActif, setEActif] = useState(true);
  const [eLang, setELang] = useState<Lang>("fr");
  const [eNom, setENom] = useState("");

  const loadUsers = useCallback(async () => {
    setLoading(true);
    const allUsers = await db.users.toArray();
    const allUE = await db.user_espaces.toArray();
    const rows: UserRow[] = allUsers.map(u => ({
      id: u.id,
      nom: u.nom,
      email: u.email,
      role: u.role,
      langue: u.langue,
      actif: u.actif,
      cree_le: u.cree_le,
      espaceIds: allUE.filter(ue => ue.user_id === u.id).map(ue => ue.espace_id),
    }));
    setUsers(rows);
    setLoading(false);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const openCreate = () => {
    setEditing(null);
    setCEmail("");
    setCPassword("");
    setCNom("");
    setCRole("operateur");
    setCLang("fr");
    setCEspaceIds(currentEspace ? [currentEspace.id] : []);
    setModalOpen(true);
  };

  const openEdit = (u: UserRow) => {
    setEditing(u);
    setERole(u.role);
    setEActif(u.actif);
    setELang(u.langue);
    setENom(u.nom);
    setEEspaceIds(u.espaceIds);
    setModalOpen(true);
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    if (!cEmail.trim() || !cPassword.trim() || !cNom.trim()) {
      setError(t(lang, "fillAllFields"));
      setSubmitting(false);
      return;
    }
    const existing = await db.users.where("email").equals(cEmail.toLowerCase().trim()).first();
    if (existing) {
      setError(t(lang, "emailExists"));
      setSubmitting(false);
      return;
    }
    const userId = genId();
    const now = new Date().toISOString();
    const newUser: LocalUser = {
      id: userId,
      nom: cNom.trim(),
      email: cEmail.toLowerCase().trim(),
      password: cPassword,
      role: cRole,
      langue: cLang,
      actif: true,
      cree_le: now,
    };
    await db.users.add(newUser);
    for (const eid of cEspaceIds) {
      await db.user_espaces.add({
        user_id: userId,
        espace_id: eid,
        role_dans_espace: cRole,
      });
    }
    setModalOpen(false);
    setSubmitting(false);
    loadUsers();
  };

  const toggleCEspace = (id: string) => {
    setCEspaceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const toggleEEspace = (id: string) => {
    setEEspaceIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  };

  const handleUpdate = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setSubmitting(true);
    setError(null);
    await db.users.update(editing.id, {
      nom: eNom,
      role: eRole,
      actif: eActif,
      langue: eLang,
    });
    const existingUE = await db.user_espaces.where("user_id").equals(editing.id).toArray();
    for (const ue of existingUE) {
      if (ue.id) await db.user_espaces.delete(ue.id);
    }
    for (const eid of eEspaceIds) {
      await db.user_espaces.add({
        user_id: editing.id,
        espace_id: eid,
        role_dans_espace: eRole,
      });
    }
    setModalOpen(false);
    setSubmitting(false);
    loadUsers();
  };

  const handleDeleteUser = async (userId: string) => {
    if (!window.confirm(t(lang, "confirmDeleteUser"))) return;
    const ueRows = await db.user_espaces.where("user_id").equals(userId).toArray();
    for (const ue of ueRows) {
      if (ue.id) await db.user_espaces.delete(ue.id);
    }
    await db.users.delete(userId);
    loadUsers();
  };

  return (
    <Layout
      title={t(lang, "users")}
      subtitle={t(lang, "adminView")}
      actions={
        <button onClick={openCreate} className="btn-primary">
          <Plus size={16} />
          {t(lang, "addUser")}
        </button>
      }
    >
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2.5 text-sm text-rose-300">
          <AlertCircle size={16} />
          {error}
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
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-3 font-semibold">{t(lang, "nom")}</th>
                  <th className="px-4 py-3 font-semibold">{t(lang, "email")}</th>
                  <th className="px-4 py-3 font-semibold">{t(lang, "role")}</th>
                  <th className="px-4 py-3 font-semibold">{t(lang, "status")}</th>
                  <th className="px-4 py-3 font-semibold">{t(lang, "language")}</th>
                  <th className="px-4 py-3 font-semibold">{t(lang, "userEspaces")}</th>
                  <th className="px-4 py-3 font-semibold">{t(lang, "createdOn")}</th>
                  <th className="px-4 py-3 text-right font-semibold">{t(lang, "actions")}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 transition hover:bg-white/[0.03]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-emerald-500 to-cyan-600 text-xs font-bold text-white">
                          {u.nom.charAt(0).toUpperCase()}
                        </div>
                        <span className="font-medium text-slate-200">{u.nom}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{u.email}</td>
                    <td className="px-4 py-3">
                      {u.role === "admin" ? (
                        <span className="badge-admin">{t(lang, "admin")}</span>
                      ) : u.role === "superviseur" ? (
                        <span className="badge-synced">{t(lang, "superviseur")}</span>
                      ) : (
                        <span className="badge-operator">{t(lang, "operator")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {u.actif ? (
                        <span className="badge-synced">{t(lang, "active")}</span>
                      ) : (
                        <span className="badge-expense">{t(lang, "inactive")}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">
                      {u.langue === "fr" ? t(lang, "french") : t(lang, "malagasy")}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {u.espaceIds.length > 0 ? (
                          u.espaceIds.map((eid) => {
                            const es = espaces.find(e => e.id === eid);
                            return (
                              <span key={eid} className="rounded-md bg-white/5 px-2 py-0.5 text-xs text-slate-300">
                                {es?.nom ?? "—"}
                              </span>
                            );
                          })
                        ) : (
                          <span className="text-xs text-slate-600">{t(lang, "noEspacesAssigned")}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-400">{formatDateTime(u.cree_le, lang)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => openEdit(u)}
                          disabled={u.id === me?.id}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-emerald-400 disabled:opacity-30"
                          title={t(lang, "edit")}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(u.id)}
                          disabled={u.id === me?.id}
                          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400 disabled:opacity-30"
                          title={t(lang, "deleteUser")}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalOpen(false)} />
          <div className="card relative z-10 w-full max-w-md animate-fade-up p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white">
                {editing ? t(lang, "editUser") : t(lang, "addUser")}
              </h2>
              <button
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={editing ? handleUpdate : handleCreate} className="space-y-4">
              {!editing && (
                <>
                  <div>
                    <label className="input-label">{t(lang, "nom")}</label>
                    <div className="relative">
                      <User size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="text"
                        value={cNom}
                        onChange={(e) => setCNom(e.target.value)}
                        className="input pl-10"
                        placeholder={t(lang, "nom")}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="input-label">{t(lang, "email")}</label>
                    <div className="relative">
                      <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="email"
                        value={cEmail}
                        onChange={(e) => setCEmail(e.target.value)}
                        className="input pl-10"
                        placeholder={t(lang, "email")}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="input-label">{t(lang, "password")}</label>
                    <div className="relative">
                      <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        type="password"
                        value={cPassword}
                        onChange={(e) => setCPassword(e.target.value)}
                        className="input pl-10"
                        placeholder={t(lang, "password")}
                      />
                    </div>
                  </div>
                </>
              )}

              {editing && (
                <div>
                  <label className="input-label">{t(lang, "nom")}</label>
                  <input
                    type="text"
                    value={eNom}
                    onChange={(e) => setENom(e.target.value)}
                    className="input"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="input-label">{t(lang, "role")}</label>
                  <select
                    value={editing ? eRole : cRole}
                    onChange={(e) =>
                      editing ? setERole(e.target.value as UserRole) : setCRole(e.target.value as UserRole)
                    }
                    className="input"
                    disabled={editing?.id === me?.id}
                  >
                    <option value="operateur">{t(lang, "operator")}</option>
                    <option value="admin">{t(lang, "admin")}</option>
                    <option value="superviseur">{t(lang, "superviseur")}</option>
                  </select>
                </div>
                <div>
                  <label className="input-label">{t(lang, "language")}</label>
                  <select
                    value={editing ? eLang : cLang}
                    onChange={(e) =>
                      editing ? setELang(e.target.value as Lang) : setCLang(e.target.value as Lang)
                    }
                    className="input"
                  >
                    <option value="fr">{t(lang, "french")}</option>
                    <option value="mg">{t(lang, "malagasy")}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="input-label">{t(lang, "userEspaces")}</label>
                <div className="flex flex-wrap gap-2">
                  {espaces.map((es) => {
                    const selected = editing ? eEspaceIds.includes(es.id) : cEspaceIds.includes(es.id);
                    return (
                      <button
                        key={es.id}
                        type="button"
                        onClick={() => editing ? toggleEEspace(es.id) : toggleCEspace(es.id)}
                        className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                          selected
                            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                            : "border-white/10 bg-white/5 text-slate-400 hover:border-white/25"
                        }`}
                      >
                        {selected && <CheckCircle2 size={12} />}
                        {es.nom}
                      </button>
                    );
                  })}
                </div>
                {(editing ? eEspaceIds : cEspaceIds).length === 0 && (
                  <p className="mt-1 text-xs text-amber-400">{t(lang, "atLeastOneEspace")}</p>
                )}
              </div>

              {editing && (
                <div>
                  <label className="input-label">{t(lang, "status")}</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setEActif(true)}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                        eActif
                          ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                      disabled={editing.id === me?.id}
                    >
                      <ShieldCheck size={16} />
                      {t(lang, "active")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEActif(false)}
                      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${
                        !eActif
                          ? "border-rose-500/60 bg-rose-500/15 text-rose-300"
                          : "border-white/10 bg-white/5 text-slate-400"
                      }`}
                      disabled={editing.id === me?.id}
                    >
                      <ShieldX size={16} />
                      {t(lang, "inactive")}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary flex-1">
                  {t(lang, "cancel")}
                </button>
                <button type="submit" disabled={submitting} className="btn-primary flex-1">
                  {submitting ? t(lang, "loading") : t(lang, "save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Layout>
  );
}
