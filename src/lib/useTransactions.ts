import { useCallback, useEffect, useState } from "react";
import {
  db,
  dirtyFlag,
  genClientUuid,
  isLocalMode,
  notifyDataChanged,
  nowISO,
  todayISO,
  uuidFromString,
  type Frequence,
  type LocalTransaction,
} from "./db";
import { useAuth } from "./auth";
import { useEspace } from "./espace";
import { useDataVersion } from "./sync";
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

export const DEFAULT_THRESHOLD = 100000;

export function nextOccurrence(date: string, freq: Frequence): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  switch (freq) {
    case "quotidien": dt.setDate(dt.getDate() + 1); break;
    case "hebdomadaire": dt.setDate(dt.getDate() + 7); break;
    case "mensuel": {
      // 31 janvier → 28/29 février (et non 3 mars)
      const target = new Date(dt.getFullYear(), dt.getMonth() + 1, 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      dt.setFullYear(target.getFullYear(), target.getMonth(), Math.min(d, last));
      break;
    }
    case "annuel": dt.setFullYear(dt.getFullYear() + 1); break;
  }
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

/**
 * Crée les transactions des récurrences arrivées à échéance.
 * L'identifiant de chaque occurrence est déterministe : deux appareils qui
 * génèrent la même échéance produisent la même ligne (pas de doublon au cloud).
 */
export async function generateDueRecurring(espaceId: string, userId: string): Promise<number> {
  const today = todayISO();
  const due = (await db.recurring.where("espace_id").equals(espaceId).toArray()).filter(
    (r) => r.actif && !r.deleted && r.auteur_id === userId && r.prochaine_occurrence <= today,
  );
  let created = 0;
  for (const r of due) {
    let next = r.prochaine_occurrence;
    for (let guard = 0; next <= today && guard < 400; guard++) {
      const client_uuid = await uuidFromString(`recurring:${r.uuid}:${next}`);
      if (!(await db.transactions.where("client_uuid").equals(client_uuid).count())) {
        await db.transactions.add({
          client_uuid,
          date_transaction: next,
          motif: r.motif,
          type_operation: r.type_operation,
          montant: r.montant,
          categorie: r.categorie,
          statut: "validee",
          auteur_id: userId,
          cree_le: nowISO(),
          modifie_le: null,
          supprime: false,
          espace_id: espaceId,
          dirty: dirtyFlag(),
        });
        created++;
      }
      next = nextOccurrence(next, r.frequence);
    }
    await db.recurring.update(r.id!, { prochaine_occurrence: next, dirty: dirtyFlag() });
  }
  if (created) notifyDataChanged();
  return created;
}

async function addLocalAudit(action: string, recordId: string, oldValue: unknown, newValue: unknown, authorId: string, espaceId: string) {
  // En mode cloud, c'est le trigger SQL qui journalise (non falsifiable).
  if (!isLocalMode()) return;
  await db.journal_audit.add({
    action,
    table_concernee: "transactions",
    enregistrement_id: recordId,
    ancienne_valeur: oldValue == null ? null : JSON.stringify(oldValue),
    nouvelle_valeur: newValue == null ? null : JSON.stringify(newValue),
    auteur_id: authorId,
    date_action: nowISO(),
    espace_id: espaceId,
  });
}

export function useTransactions() {
  const { profile } = useAuth();
  const { currentEspace, role } = useEspace();
  const version = useDataVersion();
  const [transactions, setTransactions] = useState<DisplayTransaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [validationThreshold, setValidationThreshold] = useState(DEFAULT_THRESHOLD);
  const espaceId = currentEspace?.id;
  const isAdmin = role === "admin";
  const seesAll = role === "admin" || role === "superviseur";

  const load = useCallback(async () => {
    if (!espaceId || !profile) {
      setTransactions([]);
      setLoading(false);
      return;
    }
    const [rows, users, cats, seuil] = await Promise.all([
      db.transactions.where("espace_id").equals(espaceId).toArray(),
      db.users.toArray(),
      db.categories.orderBy("ordre").toArray(),
      db.settings.where("[espace_id+cle]").equals([espaceId, "seuil_validation"]).first(),
    ]);
    const names = new Map(users.map((u) => [u.id, u.nom]));
    setTransactions(
      rows
        .filter((r) => !r.supprime && (seesAll || r.auteur_id === profile.id))
        .map((r: LocalTransaction) => ({
          id: r.client_uuid,
          client_uuid: r.client_uuid,
          date_transaction: r.date_transaction,
          motif: r.motif,
          type_operation: r.type_operation,
          montant: r.montant,
          categorie: r.categorie,
          statut: r.statut,
          auteur_nom: names.get(r.auteur_id),
          cree_le: r.cree_le,
          modifie_le: r.modifie_le ?? null,
          supprime: r.supprime,
          synced: !r.dirty,
          auteur_id: r.auteur_id,
          espace_id: r.espace_id,
        }))
        .sort((a, b) => (b.date_transaction + b.cree_le).localeCompare(a.date_transaction + a.cree_le)),
    );
    setCategories(
      cats.filter((c) => c.active && !c.deleted).map((c) => ({ id: c.id!, nom: c.nom, couleur: c.couleur, icone: c.icone, ordre: c.ordre, active: c.active, user_id: c.user_id ?? null })),
    );
    const n = Number(seuil?.valeur);
    setValidationThreshold(Number.isFinite(n) && n > 0 ? n : DEFAULT_THRESHOLD);
    setLoading(false);
  }, [espaceId, profile, seesAll]);

  useEffect(() => {
    load().catch((err) => {
      console.error("[transactions] chargement", err);
      setLoading(false);
    });
  }, [load, version]);

  // Récurrences dues : à l'ouverture et quand l'espace change.
  useEffect(() => {
    if (espaceId && profile) generateDueRecurring(espaceId, profile.id).catch(() => undefined);
  }, [espaceId, profile]);

  const createTransaction = useCallback(
    async (data: TransactionFormData) => {
      if (!profile || !espaceId) throw new Error("Aucun espace sélectionné");
      const statut: LocalTransaction["statut"] = data.montant >= validationThreshold && !isAdmin ? "en_attente_validation" : "validee";
      const row: LocalTransaction = {
        client_uuid: data.client_uuid || genClientUuid(),
        date_transaction: data.date_transaction,
        motif: data.motif.trim().slice(0, 255),
        type_operation: data.type_operation,
        montant: data.montant,
        categorie: data.categorie,
        statut,
        auteur_id: profile.id,
        cree_le: nowISO(),
        modifie_le: null,
        supprime: false,
        espace_id: espaceId,
        dirty: dirtyFlag(),
      };
      await db.transactions.add(row);
      await addLocalAudit("creation", row.client_uuid, null, data, profile.id, espaceId);
      notifyDataChanged();
    },
    [profile, espaceId, validationThreshold, isAdmin],
  );

  const updateTransaction = useCallback(
    async (clientUuid: string, data: TransactionFormData) => {
      if (!profile || !espaceId) return;
      const local = await db.transactions.where("client_uuid").equals(clientUuid).first();
      if (!local?.id) return;
      // Seuls l'admin et l'auteur modifient (règle aussi appliquée par la base).
      if (!isAdmin && local.auteur_id !== profile.id) throw new Error("Lecture seule : vous ne pouvez modifier que vos propres saisies");
      const changes: Partial<LocalTransaction> = {
        date_transaction: data.date_transaction,
        motif: data.motif.trim().slice(0, 255),
        type_operation: data.type_operation,
        montant: data.montant,
        categorie: data.categorie,
        modifie_le: nowISO(),
        dirty: dirtyFlag(),
      };
      if (!isAdmin && data.montant >= validationThreshold) changes.statut = "en_attente_validation";
      await db.transactions.update(local.id, changes);
      await addLocalAudit("modification", clientUuid, local, data, profile.id, espaceId);
      notifyDataChanged();
    },
    [profile, espaceId, isAdmin, validationThreshold],
  );

  const deleteTransaction = useCallback(
    async (clientUuid: string) => {
      if (!profile || !espaceId) return;
      const local = await db.transactions.where("client_uuid").equals(clientUuid).first();
      if (!local?.id) return;
      if (!isAdmin && local.auteur_id !== profile.id) throw new Error("Lecture seule : vous ne pouvez supprimer que vos propres saisies");
      await db.transactions.update(local.id, { supprime: true, modifie_le: nowISO(), dirty: dirtyFlag() });
      await addLocalAudit("suppression", clientUuid, local, null, profile.id, espaceId);
      notifyDataChanged();
    },
    [profile, espaceId, isAdmin],
  );

  const validateTransaction = useCallback(
    async (clientUuid: string) => {
      if (!profile || !espaceId || !isAdmin) return;
      const local = await db.transactions.where("client_uuid").equals(clientUuid).first();
      if (!local?.id) return;
      await db.transactions.update(local.id, { statut: "validee", modifie_le: nowISO(), dirty: dirtyFlag() });
      await addLocalAudit("validation", clientUuid, local.statut, "validee", profile.id, espaceId);
      notifyDataChanged();
    },
    [profile, espaceId, isAdmin],
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
    reload: load,
    genClientUuid,
  };
}
