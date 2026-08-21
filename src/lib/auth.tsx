import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { supabase } from "./supabase";
import { db } from "./db";
import type { Lang } from "./i18n";

export type UserRole = "operateur" | "admin" | "superviseur";

export interface Profile {
  id: string;
  nom: string;
  email: string;
  role: UserRole;
  langue: Lang;
  actif: boolean;
  cree_le: string;
}

interface AuthContextValue {
  session: { user: { id: string; email: string } } | null;
  user: { id: string; email: string } | null;
  profile: Profile | null;
  loading: boolean;
  lang: Lang;
  setLang: (l: Lang) => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, nom: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const PROFILE_CACHE_KEY = "mtantana_profile_cache";

function readCachedProfile(): Profile | null {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Profile;
  } catch {
    return null;
  }
}

function writeCachedProfile(p: Profile | null) {
  if (p) localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(p));
  else localStorage.removeItem(PROFILE_CACHE_KEY);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<{ user: { id: string; email: string } } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(readCachedProfile());
  const [loading, setLoading] = useState(true);
  const [lang, setLangState] = useState<Lang>(readCachedProfile()?.langue ?? "fr");

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      if (data.session) {
        setSession({ user: { id: data.session.user.id, email: data.session.user.email ?? "" } });
        loadProfile(data.session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      (async () => {
        if (sess) {
          setSession({ user: { id: sess.user.id, email: sess.user.email ?? "" } });
          await loadProfile(sess.user.id);
        } else {
          setSession(null);
          setProfile(null);
          writeCachedProfile(null);
          setLoading(false);
        }
      })();
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, nom, email, role, langue, actif, cree_le")
        .eq("id", userId)
        .maybeSingle();

      if (error || !data) {
        setLoading(false);
        return;
      }

      const p: Profile = {
        id: data.id,
        nom: data.nom,
        email: data.email,
        role: data.role as UserRole,
        langue: data.langue as Lang,
        actif: data.actif,
        cree_le: data.cree_le,
      };

      setProfile(p);
      writeCachedProfile(p);
      setLangState(p.langue);

      await db.users.put({
        id: p.id,
        nom: p.nom,
        email: p.email,
        password: "",
        role: p.role,
        langue: p.langue,
        actif: p.actif,
        cree_le: p.cree_le,
      });
    } catch {
      // keep cached profile
    } finally {
      setLoading(false);
    }
  }

  const setLang = (l: Lang) => {
    setLangState(l);
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.toLowerCase().trim(),
      password,
    });
    if (error) {
      if (error.message.includes("Invalid login")) return { error: "E-mail ou mot de passe incorrect" };
      if (error.message.includes("Email not confirmed")) return { error: "Votre e-mail n'est pas encore confirmé" };
      return { error: error.message };
    }
    return { error: null };
  };

  const signUp = async (email: string, password: string, nom: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.toLowerCase().trim(),
      password,
      options: { data: { nom } },
    });
    if (error) {
      if (error.message.includes("already registered")) return { error: "Un compte existe déjà avec cet e-mail" };
      return { error: error.message };
    }
    if (data.user) {
      // Profile is created by a DB trigger; fetch it
      await loadProfile(data.user.id);
    }
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setProfile(null);
    writeCachedProfile(null);
  };

  const refreshProfile = async () => {
    const sess = await supabase.auth.getSession();
    if (sess.data.session) {
      await loadProfile(sess.data.session.user.id);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        lang,
        setLang,
        signIn,
        signUp,
        signOut,
        refreshProfile,
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
