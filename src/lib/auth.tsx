import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { cloudConfigured, isCloudReachable, onCloudReachabilityChange, pingCloud, supabase } from "./supabase";
import { db, genId, openDatabaseFor } from "./db";
import type { Lang } from "./i18n";

export type UserRole = "operateur" | "admin" | "superviseur";
/** `cloud` : compte Supabase synchronisé. `local` : sans compte, données sur l'appareil uniquement. */
export type AuthMode = "cloud" | "local";
/** État du serveur Supabase : `unconfigured` (pas de .env), `unreachable` (en pause / hors ligne). */
export type CloudStatus = "ok" | "unreachable" | "unconfigured";

export interface Profile {
  id: string;
  nom: string;
  email: string;
  role: UserRole;
  langue: Lang;
  actif: boolean;
  cree_le: string;
}

type Result = { error: string | null };

interface AuthContextValue {
  mode: AuthMode | null;
  cloudStatus: CloudStatus;
  session: { user: { id: string; email: string } } | null;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  loading: boolean;
  /** true quand l'utilisateur arrive depuis le lien « mot de passe oublié ». */
  recovery: boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  signIn: (email: string, password: string) => Promise<Result>;
  signUp: (email: string, password: string, nom: string) => Promise<Result & { needsConfirmation?: boolean }>;
  signInWithGoogle: () => Promise<Result>;
  sendPasswordReset: (email: string) => Promise<Result>;
  updatePassword: (newPassword: string, currentPassword?: string) => Promise<Result>;
  enterLocalMode: (nom: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateOwnProfile: (changes: { nom?: string; langue?: Lang }) => Promise<Result>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const MODE_KEY = "mtantana_mode";
const LOCAL_PROFILE_KEY = "mtantana_local_profile";
const LAST_UID_KEY = "mtantana_last_uid";
const LANG_KEY = "mtantana_lang";
const profileCacheKey = (uid: string) => `mtantana_profile_${uid}`;

export const MIN_PASSWORD_LENGTH = 8;
export const googleLoginEnabled = import.meta.env.VITE_ENABLE_GOOGLE_LOGIN === "true";

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* stockage indisponible */
  }
}

const TIMEOUT = Symbol("timeout");
function withTimeout<T>(p: PromiseLike<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return Promise.race([Promise.resolve(p), new Promise<typeof TIMEOUT>((r) => setTimeout(() => r(TIMEOUT), ms))]);
}

const SERVER_DOWN = "Le serveur en ligne ne répond pas (projet Supabase en pause ?). Vous pouvez utiliser l'application sans compte en attendant.";

function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login")) return "E-mail ou mot de passe incorrect";
  if (m.includes("email not confirmed")) return "Votre e-mail n'est pas encore confirmé. Ouvrez le lien reçu par e-mail.";
  if (m.includes("already registered") || m.includes("already been registered")) return "Un compte existe déjà avec cet e-mail";
  if (m.includes("banned")) return "Ce compte a été désactivé par un administrateur";
  if (m.includes("rate limit") || m.includes("too many")) return "Trop de tentatives. Réessayez dans quelques minutes.";
  if (m.includes("password") && m.includes("characters")) return `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères`;
  if (m.includes("weak")) return "Mot de passe trop faible : mélangez lettres, chiffres et symboles";
  if (m.includes("fetch") || m.includes("network") || m.includes("abort")) {
    return navigator.onLine ? SERVER_DOWN : "Connexion impossible. Vérifiez votre accès Internet.";
  }
  if (m.includes("same password") || m.includes("different from the old")) return "Le nouveau mot de passe doit être différent de l'ancien";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<AuthMode | null>(null);
  const [session, setSession] = useState<{ user: { id: string; email: string } } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);
  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem(LANG_KEY) as Lang) || "fr");
  const currentUid = useRef<string | null>(null);
  const [reachable, setReachable] = useState(isCloudReachable());
  useEffect(() => onCloudReachabilityChange(setReachable), []);
  const cloudStatus: CloudStatus = !cloudConfigured ? "unconfigured" : reachable ? "ok" : "unreachable";

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(LANG_KEY, l);
    } catch {
      /* ignore */
    }
  }, []);

  const loadProfile = useCallback(async (uid: string, email: string): Promise<Profile | null> => {
    const cached = readJSON<Profile>(profileCacheKey(uid));
    if (!navigator.onLine || !isCloudReachable()) return cached;
    try {
      // Au plus 5 s : un serveur lent ne doit pas bloquer l'ouverture.
      const res = await withTimeout(
        supabase.from("profiles").select("id, nom, email, role, langue, actif, cree_le").eq("id", uid).maybeSingle(),
        5000,
      );
      if (res === TIMEOUT) return cached;
      const { data, error } = res;
      if (error || !data) return cached;
      const p: Profile = { ...data, email: data.email ?? email, role: data.role as UserRole, langue: data.langue as Lang };
      writeJSON(profileCacheKey(uid), p);
      return p;
    } catch {
      return cached;
    }
  }, []);

  const activateCloud = useCallback(
    async (sess: Session | { user: { id: string; email?: string | null } }) => {
      const uid = sess.user.id;
      const email = sess.user.email ?? "";
      if (currentUid.current !== uid) {
        await openDatabaseFor(uid);
        currentUid.current = uid;
      }
      const p = await loadProfile(uid, email);
      if (p && p.actif === false) {
        await supabase.auth.signOut({ scope: "local" });
        setSession(null);
        setProfile(null);
        setMode(null);
        return;
      }
      const prof: Profile = p ?? { id: uid, nom: email.split("@")[0], email, role: "operateur", langue: "fr", actif: true, cree_le: new Date().toISOString() };
      await db.users.put({ ...prof });
      localStorage.setItem(MODE_KEY, "cloud");
      localStorage.setItem(LAST_UID_KEY, uid);
      setSession({ user: { id: uid, email } });
      setProfile(prof);
      if (p?.langue) setLang(p.langue);
      setMode("cloud");
    },
    [loadProfile, setLang],
  );

  const activateLocal = useCallback(async () => {
    let p = readJSON<Profile>(LOCAL_PROFILE_KEY);
    if (!p) return false;
    await openDatabaseFor(null);
    currentUid.current = "local";
    // Un espace local doit toujours exister.
    if ((await db.espaces.count()) === 0) {
      const id = genId();
      await db.espaces.add({ id, nom: "Mon espace", cree_le: new Date().toISOString() });
      await db.user_espaces.add({ user_id: p.id, espace_id: id, role_dans_espace: "admin" });
    }
    p = { ...p, role: "admin", actif: true };
    await db.users.put({ ...p });
    setSession({ user: { id: p.id, email: "" } });
    setProfile(p);
    setLang(p.langue);
    setMode("local");
    return true;
  }, [setLang]);

  // Initialisation : ne doit JAMAIS dépendre de la disponibilité de Supabase.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const savedMode = localStorage.getItem(MODE_KEY);
        // Mode sans compte : aucun appel réseau.
        if (savedMode === "local") {
          await activateLocal();
          return;
        }
        if (!cloudConfigured) return;

        // Serveur injoignable (projet en pause, hors ligne…) : on ouvre avec le
        // profil en cache ; les données locales restent utilisables et la
        // synchronisation reprendra quand le serveur répondra.
        const openFromCache = async () => {
          const uid = localStorage.getItem(LAST_UID_KEY);
          const cached = uid ? readJSON<Profile>(profileCacheKey(uid)) : null;
          if (savedMode === "cloud" && uid && cached && !cancelled) {
            await activateCloud({ user: { id: uid, email: cached.email } });
          }
        };

        // En parallèle : si le serveur est injoignable (DNS, pause), inutile
        // d'attendre que Supabase abandonne le rafraîchissement du jeton.
        const DOWN = Symbol("down");
        const down = savedMode === "cloud" ? pingCloud(3000).then((ok) => (ok ? new Promise<never>(() => {}) : DOWN)) : new Promise<never>(() => {});
        const res = await Promise.race([withTimeout(supabase.auth.getSession(), 5000), down]);
        if (res === DOWN) {
          await openFromCache();
          return;
        }
        if (cancelled) return;
        if (res === TIMEOUT) {
          await openFromCache();
        } else if (res.data.session) {
          await activateCloud(res.data.session);
        } else if (savedMode === "cloud" && !(await pingCloud())) {
          await openFromCache();
        }
      } catch (err) {
        console.error("[auth] init", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    const { data: listener } = supabase.auth.onAuthStateChange((event, sess) => {
      // Ne jamais appeler Supabase de façon bloquante dans ce callback.
      setTimeout(async () => {
        if (event === "PASSWORD_RECOVERY") setRecovery(true);
        if (sess && (event === "SIGNED_IN" || event === "PASSWORD_RECOVERY" || event === "USER_UPDATED")) {
          await activateCloud(sess);
          setLoading(false);
        } else if (event === "SIGNED_OUT" && localStorage.getItem(MODE_KEY) !== "local") {
          setSession(null);
          setProfile(null);
          setMode(null);
          currentUid.current = null;
        }
      }, 0);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [activateCloud, activateLocal]);

  const NOT_CONFIGURED = "Le compte en ligne n'est pas configuré sur ce site. Utilisez l'application sans compte.";

  const signIn = async (email: string, password: string): Promise<Result> => {
    if (!cloudConfigured) return { error: NOT_CONFIGURED };
    if (!navigator.onLine) return { error: "La première connexion nécessite Internet. Vous pouvez aussi utiliser l'application sans compte." };
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.toLowerCase().trim(), password });
    if (error) return { error: translateAuthError(error.message) };
    if (data.session) await activateCloud(data.session);
    return { error: null };
  };

  const signUp = async (email: string, password: string, nom: string) => {
    if (!cloudConfigured) return { error: NOT_CONFIGURED };
    if (password.length < MIN_PASSWORD_LENGTH) {
      return { error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` };
    }
    const { data, error } = await supabase.auth.signUp({
      email: email.toLowerCase().trim(),
      password,
      options: { data: { nom: nom.trim(), langue: lang }, emailRedirectTo: window.location.origin },
    });
    if (error) return { error: translateAuthError(error.message) };
    // Supabase renvoie un utilisateur sans identités si l'e-mail existe déjà.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      return { error: "Un compte existe déjà avec cet e-mail" };
    }
    if (!data.session) return { error: null, needsConfirmation: true };
    await activateCloud(data.session);
    return { error: null };
  };

  const signInWithGoogle = async (): Promise<Result> => {
    if (!cloudConfigured) return { error: NOT_CONFIGURED };
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    return { error: error ? translateAuthError(error.message) : null };
  };

  const sendPasswordReset = async (email: string): Promise<Result> => {
    if (!cloudConfigured) return { error: NOT_CONFIGURED };
    const { error } = await supabase.auth.resetPasswordForEmail(email.toLowerCase().trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error: error ? translateAuthError(error.message) : null };
  };

  const updatePassword = async (newPassword: string, currentPassword?: string): Promise<Result> => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      return { error: `Le mot de passe doit contenir au moins ${MIN_PASSWORD_LENGTH} caractères` };
    }
    if (!navigator.onLine) return { error: "Connexion Internet requise" };
    // Hors procédure de récupération, on revérifie l'ancien mot de passe.
    if (!recovery) {
      const email = session?.user.email;
      if (!email || !currentPassword) return { error: "Saisissez votre mot de passe actuel" };
      const { error: reauthErr } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (reauthErr) return { error: "Mot de passe actuel incorrect" };
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { error: translateAuthError(error.message) };
    setRecovery(false);
    return { error: null };
  };

  const enterLocalMode = async (nom: string) => {
    const existing = readJSON<Profile>(LOCAL_PROFILE_KEY);
    const p: Profile = existing ?? {
      id: genId(),
      nom: nom.trim() || "Moi",
      email: "",
      role: "admin",
      langue: lang,
      actif: true,
      cree_le: new Date().toISOString(),
    };
    writeJSON(LOCAL_PROFILE_KEY, p);
    localStorage.setItem(MODE_KEY, "local");
    await activateLocal();
  };

  const signOut = async () => {
    if (mode === "cloud") {
      // scope local : n'attend pas le serveur, mais on borne quand même l'attente.
      await withTimeout(supabase.auth.signOut({ scope: "local" }), 3000).catch(() => undefined);
    }
    localStorage.removeItem(MODE_KEY);
    currentUid.current = null;
    setSession(null);
    setProfile(null);
    setMode(null);
    setRecovery(false);
  };

  const refreshProfile = async () => {
    if (mode !== "cloud" || !session) return;
    const p = await loadProfile(session.user.id, session.user.email);
    if (p) {
      setProfile(p);
      await db.users.put({ ...p });
    }
  };

  const updateOwnProfile = async (changes: { nom?: string; langue?: Lang }): Promise<Result> => {
    if (!profile) return { error: "Non connecté" };
    const clean: { nom?: string; langue?: Lang } = {};
    if (changes.nom !== undefined) {
      const nom = changes.nom.trim().slice(0, 100);
      if (!nom) return { error: "Nom requis" };
      clean.nom = nom;
    }
    if (changes.langue) clean.langue = changes.langue;

    if (mode === "cloud") {
      if (!navigator.onLine) return { error: "Connexion Internet requise" };
      const { error } = await supabase.from("profiles").update(clean).eq("id", profile.id);
      if (error) return { error: error.message };
    }
    const next = { ...profile, ...clean };
    setProfile(next);
    await db.users.put({ ...next });
    writeJSON(mode === "local" ? LOCAL_PROFILE_KEY : profileCacheKey(profile.id), next);
    if (clean.langue) setLang(clean.langue);
    return { error: null };
  };

  return (
    <AuthContext.Provider
      value={{
        mode,
        cloudStatus,
        session,
        user: session?.user ?? null,
        profile,
        loading,
        recovery,
        lang,
        setLang,
        signIn,
        signUp,
        signInWithGoogle,
        sendPasswordReset,
        updatePassword,
        enterLocalMode,
        signOut,
        refreshProfile,
        updateOwnProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
