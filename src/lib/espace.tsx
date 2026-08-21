import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { db, genId, type LocalEspace } from "./db";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export interface Espace {
  id: string;
  nom: string;
  cree_le: string;
  role_dans_espace: string;
}

interface EspaceContextValue {
  espaces: Espace[];
  currentEspace: Espace | null;
  setCurrentEspace: (e: Espace | null) => void;
  loading: boolean;
  refresh: () => Promise<void>;
  addEspaceOptimistic: (e: Espace) => void;
  createEspace: (nom: string) => Promise<{ error: string | null }>;
  deleteEspace: (espaceId: string) => Promise<{ error: string | null }>;
  resetEspace: (espaceId: string) => Promise<{ error: string | null }>;
  renameEspace: (espaceId: string, nouveauNom: string) => Promise<{ error: string | null }>;
}

const EspaceContext = createContext<EspaceContextValue | undefined>(undefined);

export function EspaceProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [espaces, setEspaces] = useState<Espace[]>([]);
  const [currentEspace, setCurrentEspaceState] = useState<Espace | null>(null);
  const [loading, setLoading] = useState(true);

  const loadEspaces = async () => {
    if (!profile) {
      setEspaces([]);
      setCurrentEspaceState(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Try cloud first
      if (navigator.onLine) {
        const { data: cloudUE, error } = await supabase
          .from("user_espaces")
          .select("user_id, espace_id, role_dans_espace")
          .eq("user_id", profile.id);

        if (!error && cloudUE && cloudUE.length > 0) {
          const espaceIds = cloudUE.map((ue) => ue.espace_id);
          const { data: cloudEspaces } = await supabase
            .from("espaces")
            .select("id, nom, cree_le")
            .in("id", espaceIds);

          if (cloudEspaces) {
            // Update local cache
            for (const e of cloudEspaces) {
              await db.espaces.put({ id: e.id, nom: e.nom, cree_le: e.cree_le });
            }
            for (const ue of cloudUE) {
              const existing = await db.user_espaces
                .where("user_id").equals(ue.user_id)
                .and((row) => row.espace_id === ue.espace_id)
                .first();
              if (!existing) {
                await db.user_espaces.add({
                  user_id: ue.user_id,
                  espace_id: ue.espace_id,
                  role_dans_espace: ue.role_dans_espace as "operateur" | "admin" | "superviseur",
                });
              }
            }
          }
        }
      }

      // Load from local (serves as cache and offline fallback)
      const userEspaces = await db.user_espaces.where("user_id").equals(profile.id).toArray();
      if (userEspaces.length === 0) {
        setEspaces([]);
        setCurrentEspaceState(null);
        setLoading(false);
        return;
      }

      const espaceIds = userEspaces.map((ue) => ue.espace_id);
      const allEspaces = await db.espaces.toArray();
      const list: Espace[] = allEspaces
        .filter((e: LocalEspace) => espaceIds.includes(e.id))
        .map((e) => ({
          id: e.id,
          nom: e.nom,
          cree_le: e.cree_le,
          role_dans_espace: userEspaces.find((ue) => ue.espace_id === e.id)?.role_dans_espace ?? "operateur",
        }));

      setEspaces(list);

      const stored = localStorage.getItem("currentEspaceId");
      const found = list.find((e) => e.id === stored);
      setCurrentEspaceState(found ?? list[0] ?? null);
    } catch (err) {
      console.error("[espace] loadEspaces error:", err);
      setEspaces([]);
      setCurrentEspaceState(null);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadEspaces();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => setLoading(false), 5000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  const setCurrentEspace = (e: Espace | null) => {
    setCurrentEspaceState(e);
    if (e) localStorage.setItem("currentEspaceId", e.id);
    else localStorage.removeItem("currentEspaceId");
  };

  const refresh = async () => { await loadEspaces(); };

  const addEspaceOptimistic = (e: Espace) => {
    setEspaces((prev) => {
      if (prev.some((p) => p.id === e.id)) return prev;
      return [...prev, e];
    });
    setCurrentEspaceState(e);
    localStorage.setItem("currentEspaceId", e.id);
  };

  const createEspace = async (nom: string): Promise<{ error: string | null }> => {
    if (!profile) return { error: "Non connecté" };
    if (!nom.trim()) return { error: "Nom requis" };
    const id = genId();
    const now = new Date().toISOString();

    await db.espaces.add({ id, nom: nom.trim(), cree_le: now });
    await db.user_espaces.add({
      user_id: profile.id,
      espace_id: id,
      role_dans_espace: "admin",
    });

    if (navigator.onLine) {
      const { error: espErr } = await supabase
        .from("espaces")
        .insert({ id, nom: nom.trim(), cree_le: now, cree_par: profile.id });
      if (espErr) return { error: espErr.message };

      const { error: ueErr } = await supabase
        .from("user_espaces")
        .insert({ user_id: profile.id, espace_id: id, role_dans_espace: "admin" });
      if (ueErr) return { error: ueErr.message };
    }

    addEspaceOptimistic({ id, nom: nom.trim(), cree_le: now, role_dans_espace: "admin" });
    return { error: null };
  };

  const deleteEspace = async (espaceId: string): Promise<{ error: string | null }> => {
    const allEspaces = await db.user_espaces.where("espace_id").equals(espaceId).count();
    if (allEspaces <= 1) return { error: "Impossible de supprimer le dernier espace" };

    await db.transactions.where("espace_id").equals(espaceId).delete();
    await db.budgets.where("espace_id").equals(espaceId).delete();
    await db.alertes.where("espace_id").equals(espaceId).delete();
    await db.journal_audit.where("espace_id").equals(espaceId).delete();
    await db.recurring.where("espace_id").equals(espaceId).delete();
    await db.scheduled.where("espace_id").equals(espaceId).delete();
    await db.settings.where("espace_id").equals(espaceId).delete();
    await db.user_espaces.where("espace_id").equals(espaceId).delete();
    await db.espaces.where("id").equals(espaceId).delete();

    if (navigator.onLine) {
      await supabase.from("transactions").delete().eq("espace_id", espaceId);
      await supabase.from("budgets").delete().eq("espace_id", espaceId);
      await supabase.from("alertes").delete().eq("espace_id", espaceId);
      await supabase.from("journal_audit").delete().eq("espace_id", espaceId);
      await supabase.from("transactions_recurrentes").delete().eq("espace_id", espaceId);
      await supabase.from("transactions_planifiees").delete().eq("espace_id", espaceId);
      await supabase.from("settings").delete().eq("espace_id", espaceId);
      await supabase.from("user_espaces").delete().eq("espace_id", espaceId);
      await supabase.from("espaces").delete().eq("id", espaceId);
    }

    await refresh();
    return { error: null };
  };

  const resetEspace = async (espaceId: string): Promise<{ error: string | null }> => {
    await db.transactions.where("espace_id").equals(espaceId).delete();
    await db.budgets.where("espace_id").equals(espaceId).delete();
    await db.alertes.where("espace_id").equals(espaceId).delete();
    await db.journal_audit.where("espace_id").equals(espaceId).delete();
    await db.recurring.where("espace_id").equals(espaceId).delete();
    await db.scheduled.where("espace_id").equals(espaceId).delete();

    if (navigator.onLine) {
      await supabase.from("transactions").delete().eq("espace_id", espaceId);
      await supabase.from("budgets").delete().eq("espace_id", espaceId);
      await supabase.from("alertes").delete().eq("espace_id", espaceId);
      await supabase.from("journal_audit").delete().eq("espace_id", espaceId);
      await supabase.from("transactions_recurrentes").delete().eq("espace_id", espaceId);
      await supabase.from("transactions_planifiees").delete().eq("espace_id", espaceId);
    }

    return { error: null };
  };

  const renameEspace = async (espaceId: string, nouveauNom: string): Promise<{ error: string | null }> => {
    if (!nouveauNom.trim()) return { error: "Nom requis" };
    await db.espaces.update(espaceId, { nom: nouveauNom.trim() });
    if (navigator.onLine) {
      const { error } = await supabase.from("espaces").update({ nom: nouveauNom.trim() }).eq("id", espaceId);
      if (error) return { error: error.message };
    }
    await refresh();
    return { error: null };
  };

  return (
    <EspaceContext.Provider value={{ espaces, currentEspace, setCurrentEspace, loading, refresh, addEspaceOptimistic, createEspace, deleteEspace, resetEspace, renameEspace }}>
      {children}
    </EspaceContext.Provider>
  );
}

export function useEspace() {
  const ctx = useContext(EspaceContext);
  if (!ctx) throw new Error("useEspace must be used within EspaceProvider");
  return ctx;
}
