import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { db, genId, notifyDataChanged, purgeEspaceLocal, type Role } from "./db";
import { isCloudReachable, supabase } from "./supabase";
import { acceptInvitations } from "./sync";
import { useAuth } from "./auth";

export interface Espace {
  id: string;
  nom: string;
  cree_le: string;
  role_dans_espace: Role;
}

type Result = { error: string | null };

interface EspaceContextValue {
  espaces: Espace[];
  currentEspace: Espace | null;
  /** Rôle de l'utilisateur DANS l'espace courant (c'est lui qui donne les droits). */
  role: Role;
  setCurrentEspace: (e: Espace | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  createEspace: (nom: string) => Promise<Result>;
  deleteEspace: (espaceId: string) => Promise<Result>;
  resetEspace: (espaceId: string) => Promise<Result>;
  renameEspace: (espaceId: string, nouveauNom: string) => Promise<Result>;
}

const EspaceContext = createContext<EspaceContextValue | undefined>(undefined);
const currentKey = (uid: string) => `mtantana_current_espace_${uid}`;
const NEED_ONLINE = "Connexion Internet requise pour cette action";

function rpcError(message: string): string {
  if (message.includes("Accès refusé") || message.includes("42501")) return "Vous n'êtes pas administrateur de cet espace";
  return message;
}

export function EspaceProvider({ children }: { children: ReactNode }) {
  const { profile, mode } = useAuth();
  const [espaces, setEspaces] = useState<Espace[]>([]);
  const [currentEspace, setCurrentEspaceState] = useState<Espace | null>(null);
  const [loading, setLoading] = useState(true);

  const loadEspaces = useCallback(async () => {
    if (!profile) {
      setEspaces([]);
      setCurrentEspaceState(null);
      setLoading(false);
      return;
    }
    const showLocal = async () => {
      const memberships = await db.user_espaces.where("user_id").equals(profile.id).toArray();
      const all = await db.espaces.bulkGet(memberships.map((m) => m.espace_id));
      const list: Espace[] = memberships
        .map((m, i) => (all[i] ? { ...all[i]!, role_dans_espace: m.role_dans_espace } : null))
        .filter((e): e is Espace => e !== null)
        .sort((a, b) => a.cree_le.localeCompare(b.cree_le));
      setEspaces(list);
      const stored = localStorage.getItem(currentKey(profile.id));
      setCurrentEspaceState((prev) => list.find((e) => e.id === (prev?.id ?? stored)) ?? list.find((e) => e.id === stored) ?? list[0] ?? null);
    };

    // 1. Affichage immédiat depuis l'appareil (jamais bloqué par le réseau).
    try {
      await showLocal();
    } catch (err) {
      console.error("[espace] chargement local", err);
    }

    // 2. Mise à jour depuis le cloud s'il répond.
    try {
      if (mode === "cloud" && navigator.onLine && isCloudReachable()) {
        const hadLocal = (await db.user_espaces.where("user_id").equals(profile.id).count()) > 0;
        // Premier démarrage sur cet appareil : on attend la liste ; sinon on ne bloque pas l'écran.
        if (hadLocal) setLoading(false);
        await acceptInvitations();
        const { data: mine, error } = await supabase
          .from("user_espaces")
          .select("espace_id, role_dans_espace, espaces(id, nom, cree_le)")
          .eq("user_id", profile.id);
        if (!error && mine) {
          const ids = new Set(mine.map((m) => m.espace_id as string));
          await db.transaction("rw", [db.espaces, db.user_espaces], async () => {
            for (const m of mine) {
              const e = m.espaces as unknown as { id: string; nom: string; cree_le: string } | null;
              if (e) await db.espaces.put({ id: e.id, nom: e.nom, cree_le: e.cree_le });
            }
            await db.user_espaces.where("user_id").equals(profile.id).delete();
            for (const m of mine) {
              await db.user_espaces.add({ user_id: profile.id, espace_id: m.espace_id as string, role_dans_espace: m.role_dans_espace as Role });
            }
          });
          for (const e of await db.espaces.toArray()) {
            if (!ids.has(e.id)) await purgeEspaceLocal(e.id);
          }
          await showLocal();
        }
      }
    } catch (err) {
      console.error("[espace] chargement cloud", err);
    } finally {
      setLoading(false);
    }
  }, [profile, mode]);

  useEffect(() => {
    setLoading(true);
    loadEspaces();
  }, [loadEspaces]);

  // Les appartenances peuvent changer à chaque synchro (ajout / retrait par un admin).
  useEffect(() => {
    const onSynced = () => loadEspaces();
    window.addEventListener("mtantana:synced", onSynced);
    return () => window.removeEventListener("mtantana:synced", onSynced);
  }, [loadEspaces]);

  const setCurrentEspace = (e: Espace | null) => {
    setCurrentEspaceState(e);
    if (!profile) return;
    if (e) localStorage.setItem(currentKey(profile.id), e.id);
    else localStorage.removeItem(currentKey(profile.id));
  };

  const createEspace = async (nom: string): Promise<Result> => {
    if (!profile) return { error: "Non connecté" };
    const clean = nom.trim().slice(0, 100);
    if (!clean) return { error: "Nom requis" };

    let created: Espace;
    if (mode === "cloud") {
      if (!navigator.onLine) return { error: NEED_ONLINE };
      const { data, error } = await supabase.rpc("create_espace", { p_nom: clean });
      if (error) return { error: rpcError(error.message) };
      const row = (Array.isArray(data) ? data[0] : data) as { id: string; nom: string; cree_le: string } | null;
      if (!row) return { error: "Création impossible" };
      created = { id: row.id, nom: row.nom, cree_le: row.cree_le, role_dans_espace: "admin" };
    } else {
      created = { id: genId(), nom: clean, cree_le: new Date().toISOString(), role_dans_espace: "admin" };
    }

    await db.espaces.put({ id: created.id, nom: created.nom, cree_le: created.cree_le });
    await db.user_espaces.add({ user_id: profile.id, espace_id: created.id, role_dans_espace: "admin" });
    setEspaces((prev) => [...prev, created]);
    setCurrentEspace(created);
    return { error: null };
  };

  const deleteEspace = async (espaceId: string): Promise<Result> => {
    if (espaces.length <= 1) return { error: "Impossible de supprimer le dernier espace" };
    if (mode === "cloud") {
      if (!navigator.onLine) return { error: NEED_ONLINE };
      const { error } = await supabase.rpc("delete_espace", { p_espace_id: espaceId });
      if (error) return { error: rpcError(error.message) };
    }
    await purgeEspaceLocal(espaceId);
    if (currentEspace?.id === espaceId) setCurrentEspace(null);
    await loadEspaces();
    notifyDataChanged();
    return { error: null };
  };

  const resetEspace = async (espaceId: string): Promise<Result> => {
    if (mode === "cloud") {
      if (!navigator.onLine) return { error: NEED_ONLINE };
      const { error } = await supabase.rpc("reset_espace", { p_espace_id: espaceId });
      if (error) return { error: rpcError(error.message) };
    }
    await purgeEspaceLocal(espaceId, { keepEspace: true });
    notifyDataChanged();
    return { error: null };
  };

  const renameEspace = async (espaceId: string, nouveauNom: string): Promise<Result> => {
    const clean = nouveauNom.trim().slice(0, 100);
    if (!clean) return { error: "Nom requis" };
    if (mode === "cloud") {
      if (!navigator.onLine) return { error: NEED_ONLINE };
      const { error } = await supabase.from("espaces").update({ nom: clean }).eq("id", espaceId);
      if (error) return { error: rpcError(error.message) };
    }
    await db.espaces.update(espaceId, { nom: clean });
    await loadEspaces();
    return { error: null };
  };

  const role: Role = currentEspace?.role_dans_espace ?? "operateur";

  return (
    <EspaceContext.Provider
      value={{ espaces, currentEspace, role, setCurrentEspace, loading, refresh: loadEspaces, createEspace, deleteEspace, resetEspace, renameEspace }}
    >
      {children}
    </EspaceContext.Provider>
  );
}

export function useEspace() {
  const ctx = useContext(EspaceContext);
  if (!ctx) throw new Error("useEspace must be used within EspaceProvider");
  return ctx;
}
