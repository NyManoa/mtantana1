import { useCallback, useEffect, useRef, useState } from "react";
import { db, deduplicateLocalDb, genClientUuid, ensureSeedData, type LocalTransaction } from "./db";
import { supabase } from "./supabase";
import { useAuth } from "./auth";
import { useEspace } from "./espace";
import type { TransactionFormData } from "@/components/TransactionForm";

export interface DisplayTransaction {
  id: string;
  client_uuid: string;
  date_transaction: string;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
  statut: "validee" | "en_attente_validation";
  auteur_nom?: string;
  cree_le: string;
  modifie_le: string | null;
  supprime: boolean;
  synced: boolean;
  auteur_id: string;
  espace_id?: string;
}

export interface Category {
  id: number;
  nom: string;
  couleur: string;
  icone: string;
  ordre: number;
  active: boolean;
  user_id?: string | null;
}

interface ProfileMap {
  [key: string]: string;
}

export function useTransactions() {
  const { profile } = useAuth();
  const { currentEspace } = useEspace();
  const [transactions, setTransactions] = useState<DisplayTransaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const profileMapRef = useRef<ProfileMap>({});
  const [validationThreshold, setValidationThreshold] = useState(100000);

  const DEFAULT_CATEGORIES: Category[] = [
    { id: 1, nom: "autre", couleur: "#64748b", icone: "Tag", ordre: 1, active: true },
    { id: 2, nom: "sakafo", couleur: "#10b981", icone: "Utensils", ordre: 2, active: true },
    { id: 3, nom: "transport", couleur: "#3b82c6", icone: "Car", ordre: 3, active: true },
    { id: 4, nom: "loyer", couleur: "#f59e0b", icone: "Home", ordre: 4, active: true },
    { id: 5, nom: "salaire", couleur: "#22c55e", icone: "Wallet", ordre: 5, active: true },
    { id: 6, nom: "fournitures", couleur: "#8b5cf6", icone: "Package", ordre: 6, active: true },
  ];

  const loadCategories = useCallback(async () => {
    try {
      const cats = await db.categories.where("active").equals(1 as unknown as boolean).toArray();
      if (cats && cats.length > 0) {
        setCategories(cats.map(c => ({ ...c, id: c.id!, user_id: null })));
      } else {
        const allCats = await db.categories.toArray();
        if (allCats.length > 0) {
          setCategories(allCats.map(c => ({ ...c, id: c.id!, user_id: null })));
        } else {
          setCategories(DEFAULT_CATEGORIES);
        }
      }
    } catch {
      setCategories(DEFAULT_CATEGORIES);
    }
  }, []);

  const loadThreshold = useCallback(async () => {
    try {
      if (!currentEspace) return;
      const setting = await db.settings
        .where("espace_id")
        .equals(currentEspace.id)
        .toArray();
      const seuil = setting.find(s => s.cle === "seuil_validation");
      if (seuil?.valeur) setValidationThreshold(Number(seuil.valeur));
    } catch {
      // keep default
    }
  }, [currentEspace]);

  const loadProfiles = useCallback(async () => {
    try {
      const users = await db.users.toArray();
      const map: ProfileMap = {};
      for (const u of users) map[u.id] = u.nom;
      profileMapRef.current = map;
    } catch {
      // ignore
    }
  }, []);

  const loadLocal = useCallback(async () => {
    const espaceId = currentEspace?.id;
    const rows = await db.transactions.toArray();
    const pm = profileMapRef.current;
    const display: DisplayTransaction[] = rows
      .filter((r) => !r.supprime && (!espaceId || r.espace_id === espaceId))
      .map((r: LocalTransaction) => ({
        id: r.client_uuid,
        client_uuid: r.client_uuid,
        date_transaction: r.date_transaction,
        motif: r.motif,
        type_operation: r.type_operation,
        montant: r.montant,
        categorie: r.categorie,
        statut: r.statut,
        auteur_nom: pm[r.auteur_id],
        cree_le: r.cree_le,
        modifie_le: r.modifie_le ?? null,
        supprime: r.supprime,
        synced: true,
        auteur_id: r.auteur_id,
        espace_id: r.espace_id,
      }))
      .sort((a, b) => (b.date_transaction + b.cree_le).localeCompare(a.date_transaction + a.cree_le));
    setTransactions(display);
  }, [currentEspace]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureSeedData();
      await deduplicateLocalDb();
      await Promise.all([loadCategories(), loadProfiles(), loadThreshold()]);
      if (!cancelled) {
        await loadLocal();
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadThreshold();
      if (!cancelled) await loadLocal();
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEspace?.id]);

  useEffect(() => {
    const onReload = async () => {
      await loadLocal();
    };
    window.addEventListener("mtantana:reload-transactions", onReload);
    return () => window.removeEventListener("mtantana:reload-transactions", onReload);
  }, [loadLocal]);

  const createTransaction = useCallback(
    async (data: TransactionFormData) => {
      if (!profile) throw new Error("No profile");
      const now = new Date().toISOString();
      const isAdmin = profile.role === "admin";
      const statut: "validee" | "en_attente_validation" =
        data.montant >= validationThreshold && !isAdmin ? "en_attente_validation" : "validee";

      await db.transactions.add({
        client_uuid: data.client_uuid,
        date_transaction: data.date_transaction,
        motif: data.motif,
        type_operation: data.type_operation,
        montant: data.montant,
        categorie: data.categorie,
        statut,
        auteur_id: profile.id,
        cree_le: now,
        modifie_le: null,
        supprime: false,
        espace_id: currentEspace?.id,
      });

      if (currentEspace?.id && navigator.onLine) {
        await supabase.from("transactions").insert({
          client_uuid: data.client_uuid,
          date_transaction: data.date_transaction,
          motif: data.motif,
          type_operation: data.type_operation,
          montant: data.montant,
          categorie: data.categorie,
          statut,
          auteur_id: profile.id,
          cree_le: now,
          modifie_le: null,
          supprime: false,
          espace_id: currentEspace.id,
        });
      }

      await addAuditEntry("creation", "transactions", data.client_uuid, null, JSON.stringify(data), profile.id, currentEspace?.id);
      await loadLocal();
    },
    [profile, validationThreshold, currentEspace, loadLocal]
  );

  const updateTransaction = useCallback(
    async (clientUuid: string, data: TransactionFormData) => {
      if (!profile) throw new Error("No profile");
      const local = await db.transactions.where("client_uuid").equals(clientUuid).first();
      if (!local?.id) return;
      const now = new Date().toISOString();
      const oldData = JSON.stringify(local);
      await db.transactions.update(local.id, {
        date_transaction: data.date_transaction,
        motif: data.motif,
        type_operation: data.type_operation,
        montant: data.montant,
        categorie: data.categorie,
        modifie_le: now,
      });

      if (navigator.onLine) {
        await supabase
          .from("transactions")
          .update({
            date_transaction: data.date_transaction,
            motif: data.motif,
            type_operation: data.type_operation,
            montant: data.montant,
            categorie: data.categorie,
            modifie_le: now,
          })
          .eq("client_uuid", clientUuid);
      }

      await addAuditEntry("modification", "transactions", clientUuid, oldData, JSON.stringify(data), profile.id, currentEspace?.id);
      await loadLocal();
    },
    [profile, loadLocal, currentEspace]
  );

  const deleteTransaction = useCallback(
    async (clientUuid: string) => {
      const local = await db.transactions.where("client_uuid").equals(clientUuid).first();
      if (!local?.id) return;
      const now = new Date().toISOString();
      await db.transactions.update(local.id, { supprime: true, modifie_le: now });

      if (navigator.onLine) {
        await supabase
          .from("transactions")
          .update({ supprime: true, modifie_le: now })
          .eq("client_uuid", clientUuid);
      }

      if (profile) {
        await addAuditEntry("suppression", "transactions", clientUuid, JSON.stringify(local), null, profile.id, currentEspace?.id);
      }
      await loadLocal();
    },
    [profile, loadLocal, currentEspace]
  );

  const validateTransaction = useCallback(
    async (clientUuid: string) => {
      const local = await db.transactions.where("client_uuid").equals(clientUuid).first();
      if (!local?.id) return;
      await db.transactions.update(local.id, { statut: "validee" });

      if (navigator.onLine) {
        await supabase
          .from("transactions")
          .update({ statut: "validee" })
          .eq("client_uuid", clientUuid);
      }

      if (profile) {
        await addAuditEntry("validation", "transactions", clientUuid, local.statut, "validee", profile.id, currentEspace?.id);
      }
      await loadLocal();
    },
    [profile, loadLocal, currentEspace]
  );

  return {
    transactions,
    categories,
    loading,
    validationThreshold,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    validateTransaction,
    reload: loadLocal,
    genClientUuid,
  };
}

async function addAuditEntry(
  action: string,
  table: string,
  recordId: string,
  oldValue: string | null,
  newValue: string | null,
  authorId: string,
  espaceId?: string,
) {
  await db.journal_audit.add({
    action,
    table_concernee: table,
    enregistrement_id: recordId,
    ancienne_valeur: oldValue,
    nouvelle_valeur: newValue,
    auteur_id: authorId,
    date_action: new Date().toISOString(),
    espace_id: espaceId ?? "",
  });
}
