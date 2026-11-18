import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { onCloudReachabilityChange, supabase } from "./supabase";
import { countPending, db, purgeEspaceLocal, type Dirty, type LocalEvent, type LocalTransaction, type Role } from "./db";

/**
 * Synchronisation hors-ligne ↔ Supabase.
 *
 * Algorithme (à chaque passage) :
 *   1. appartenances : espaces auxquels j'ai accès (les autres sont purgés de l'appareil) ;
 *   2. ENVOI des lignes locales marquées `dirty` (créations, modifications, suppressions) ;
 *   3. RÉCEPTION de l'état du cloud : il remplace les lignes locales non modifiées,
 *      et les lignes disparues du cloud sont retirées de l'appareil.
 * Une ligne refusée par le serveur (droits insuffisants, données invalides) est
 * abandonnée pour ne pas bloquer la file ; l'erreur est remontée à l'interface.
 */

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSync: string | null;
  error: string | null;
}

interface SyncContextValue {
  state: SyncState;
  sync: () => Promise<void>;
  refreshPending: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);
const PAGE = 1000;

function lastSyncKey(uid: string) {
  return `mtantana_last_sync_${uid}`;
}

export function SyncProvider({ userId, enabled, children }: { userId: string | null; enabled: boolean; children: ReactNode }) {
  const [state, setState] = useState<SyncState>({
    online: navigator.onLine,
    syncing: false,
    pending: 0,
    lastSync: null,
    error: null,
  });
  const running = useRef(false);
  const again = useRef(false);
  const uidRef = useRef(userId);
  uidRef.current = userId;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const refreshPending = useCallback(async () => {
    try {
      const pending = enabledRef.current ? await countPending() : 0;
      setState((s) => ({ ...s, pending }));
    } catch {
      /* base pas encore ouverte */
    }
  }, []);

  const sync = useCallback(async () => {
    const uid = uidRef.current;
    if (!uid || !enabledRef.current) return;
    if (!navigator.onLine) {
      setState((s) => ({ ...s, online: false }));
      return;
    }
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = true;
    setState((s) => ({ ...s, syncing: true, online: true }));
    try {
      do {
        again.current = false;
        const warnings = await runSync(uid);
        const now = new Date().toISOString();
        localStorage.setItem(lastSyncKey(uid), now);
        setState((s) => ({ ...s, lastSync: now, error: warnings.length ? warnings.join(" · ") : null }));
        window.dispatchEvent(new CustomEvent("mtantana:synced"));
      } while (again.current);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Erreur de synchronisation";
      // Colonne / table / fonction inconnue : la base en ligne n'a pas reçu les migrations.
      const outdated = /does not exist|could not find the (function|table)|schema cache/i.test(raw);
      const msg = outdated
        ? `Base en ligne pas à jour : exécutez, dans l'ordre, les fichiers du dossier supabase/sql-editor dans Supabase → SQL Editor. Vos saisies restent sur l'appareil. (${raw})`
        : raw;
      setState((s) => ({ ...s, error: msg }));
    } finally {
      running.current = false;
      setState((s) => ({ ...s, syncing: false }));
      refreshPending();
    }
  }, [refreshPending]);

  // Démarrage / changement de compte
  useEffect(() => {
    setState((s) => ({ ...s, lastSync: userId ? localStorage.getItem(lastSyncKey(userId)) : null, error: null }));
    refreshPending();
    if (enabled && userId) sync();
  }, [userId, enabled, sync, refreshPending]);

  // Connexion / déconnexion réseau
  useEffect(() => {
    const onOnline = () => {
      setState((s) => ({ ...s, online: true }));
      sync();
    };
    const onOffline = () => setState((s) => ({ ...s, online: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [sync]);

  // Le serveur répond de nouveau (fin de pause du projet…) → synchro immédiate.
  useEffect(() => onCloudReachabilityChange((ok) => ok && sync()), [sync]);

  // Modification locale → envoi groupé 1,5 s plus tard
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onChange = () => {
      refreshPending();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => sync(), 1500);
    };
    window.addEventListener("mtantana:data-changed", onChange);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("mtantana:data-changed", onChange);
    };
  }, [sync, refreshPending]);

  // Temps réel : nouvel événement dans un de mes espaces (ordre émis, saisie à
  // valider…) → enregistré, annoncé (mtantana:event) et synchro des données.
  useEffect(() => {
    if (!enabled || !userId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`evenements-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "evenements" }, async (payload) => {
        try {
          const ev = eventFromRemote(payload.new as Row);
          await db.evenements.put(ev);
          window.dispatchEvent(new CustomEvent<LocalEvent>("mtantana:event", { detail: ev }));
        } catch {
          /* base fermée (déconnexion) */
        }
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => sync(), 800);
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [enabled, userId, sync]);

  // Retour sur l'onglet + rafraîchissement périodique (5 min)
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") sync();
    }, 5 * 60 * 1000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
  }, [sync]);

  return <SyncContext.Provider value={{ state, sync, refreshPending }}>{children}</SyncContext.Provider>;
}

export function useSync() {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync must be used within SyncProvider");
  return ctx;
}

/** Compteur qui change à chaque synchro ou modification locale : à mettre dans les dépendances d'un chargement. */
export function useDataVersion() {
  const [v, setV] = useState(0);
  useEffect(() => {
    const bump = () => setV((x) => x + 1);
    window.addEventListener("mtantana:synced", bump);
    window.addEventListener("mtantana:data-changed", bump);
    window.addEventListener("mtantana:reload-transactions", bump);
    return () => {
      window.removeEventListener("mtantana:synced", bump);
      window.removeEventListener("mtantana:data-changed", bump);
      window.removeEventListener("mtantana:reload-transactions", bump);
    };
  }, []);
  return v;
}

// ---------------------------------------------------------------------------
// Moteur
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function isRejection(err: { code?: string } | null): boolean {
  // 42501 droits, 23xxx contraintes, 22xxx données invalides, PGRST1xx requêtes refusées
  const c = err?.code ?? "";
  return c === "42501" || c.startsWith("23") || c.startsWith("22") || c.startsWith("PGRST1");
}

async function fetchAll(table: string, columns: string, espaceIds: string[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in("espace_id", espaceIds)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table} : ${error.message}`);
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function runSync(uid: string): Promise<string[]> {
  const warnings: string[] = [];
  await acceptInvitations();
  const espaceIds = await syncMemberships(uid);
  if (espaceIds.length === 0) return warnings;

  await pushTransactions(uid, espaceIds, warnings);
  await pushSimple(espaceIds, warnings);
  await pushCategories(warnings);

  await pullTransactions(espaceIds);
  await pullSimple(espaceIds);
  await pullCategories();
  await pullEvents(espaceIds);
  return warnings;
}

// 1. Appartenances --------------------------------------------------------------

/**
 * Invitations adressées à l'e-mail (vérifié) de l'utilisateur → ajout aux
 * espaces correspondants. Silencieux si la migration n'est pas encore appliquée.
 */
export async function acceptInvitations(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc("accept_pending_invitations");
    const n = !error && typeof data === "number" ? data : 0;
    if (n > 0) window.dispatchEvent(new CustomEvent("mtantana:invitations-accepted", { detail: n }));
    return n;
  } catch {
    return 0;
  }
}

async function syncMemberships(uid: string): Promise<string[]> {
  const { data: mine, error } = await supabase.from("user_espaces").select("espace_id, role_dans_espace, fonction").eq("user_id", uid);
  if (error) throw new Error(error.message);
  const espaceIds = (mine ?? []).map((r) => r.espace_id as string);

  const { data: espaces, error: espErr } = espaceIds.length
    ? await supabase.from("espaces").select("id, nom, cree_le").in("id", espaceIds)
    : { data: [], error: null };
  if (espErr) throw new Error(espErr.message);

  // Tous les membres visibles (RLS : les admins voient les membres de leurs espaces)
  const { data: members } = espaceIds.length
    ? await supabase.from("user_espaces").select("user_id, espace_id, role_dans_espace, fonction").in("espace_id", espaceIds)
    : { data: [] };
  const allMembers = [...(members ?? []), ...(mine ?? []).map((m) => ({ ...m, user_id: uid }))];

  // Tous les profils visibles (RLS : personnes partageant un espace avec moi),
  // pour afficher qui a saisi / validé / exécuté.
  const { data: profiles } = espaceIds.length
    ? await supabase.from("profiles").select("id, nom, email, role, langue, actif, cree_le")
    : { data: [] };

  const keep = new Set(espaceIds);
  const staleEspaces = (await db.espaces.toArray()).filter((e) => !keep.has(e.id)).map((e) => e.id);

  await db.transaction("rw", [db.espaces, db.user_espaces, db.users], async () => {
    for (const e of espaces ?? []) await db.espaces.put({ id: e.id, nom: e.nom, cree_le: e.cree_le });
    await db.user_espaces.clear();
    const seen = new Set<string>();
    for (const m of allMembers) {
      const key = `${m.user_id}:${m.espace_id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await db.user_espaces.add({
        user_id: m.user_id as string,
        espace_id: m.espace_id as string,
        role_dans_espace: m.role_dans_espace as Role,
        fonction: (m as { fonction?: string | null }).fonction ?? null,
      });
    }
    for (const p of profiles ?? []) {
      await db.users.put({ id: p.id, nom: p.nom, email: p.email, role: p.role as Role, langue: p.langue, actif: p.actif, cree_le: p.cree_le });
    }
  });

  // Accès retiré : on efface les données de ces espaces de l'appareil.
  if (staleEspaces.length) {
    for (const id of staleEspaces) await purgeEspaceLocal(id);
  }
  return espaceIds;
}

// 2. Envoi ---------------------------------------------------------------------

function txPayload(t: LocalTransaction) {
  return {
    client_uuid: t.client_uuid,
    date_transaction: t.date_transaction,
    motif: t.motif,
    type_operation: t.type_operation,
    montant: t.montant,
    categorie: t.categorie,
    statut: t.statut,
    auteur_id: t.auteur_id,
    cree_le: t.cree_le,
    modifie_le: t.modifie_le ?? null,
    supprime: t.supprime,
    espace_id: t.espace_id,
    ordre_id: t.ordre_id ?? null,
    motif_refus: t.motif_refus ?? null,
  };
}

async function pushTransactions(uid: string, espaceIds: string[], warnings: string[]) {
  const dirty = (await db.transactions.where("dirty").equals(1).toArray()).filter((t) => espaceIds.includes(t.espace_id));
  if (dirty.length === 0) return;
  let rejected = 0;

  const done = async (rows: LocalTransaction[]) => {
    const ids = rows.map((r) => r.id!).filter(Boolean);
    await db.transactions.where("id").anyOf(ids).modify({ dirty: 0 as Dirty });
  };

  // Mes lignes : upsert (création ou mise à jour) par lots.
  const own = dirty.filter((t) => t.auteur_id === uid);
  for (let i = 0; i < own.length; i += 200) {
    const chunk = own.slice(i, i + 200);
    const { error } = await supabase.from("transactions").upsert(chunk.map(txPayload), { onConflict: "client_uuid" });
    if (!error) {
      await done(chunk);
      continue;
    }
    if (!isRejection(error)) throw new Error(error.message);
    // Un élément du lot est refusé : on isole ligne par ligne.
    for (const t of chunk) {
      const { error: e1 } = await supabase.from("transactions").upsert(txPayload(t), { onConflict: "client_uuid" });
      if (e1 && !isRejection(e1)) throw new Error(e1.message);
      if (e1) rejected++;
      await done([t]);
    }
  }

  // Lignes d'autres auteurs (modifiées par un admin) : simple mise à jour.
  for (const t of dirty.filter((x) => x.auteur_id !== uid)) {
    const { error } = await supabase
      .from("transactions")
      .update({
        date_transaction: t.date_transaction,
        motif: t.motif,
        type_operation: t.type_operation,
        montant: t.montant,
        categorie: t.categorie,
        statut: t.statut,
        modifie_le: t.modifie_le ?? null,
        supprime: t.supprime,
        motif_refus: t.motif_refus ?? null,
      })
      .eq("client_uuid", t.client_uuid);
    if (error && !isRejection(error)) throw new Error(error.message);
    if (error) rejected++;
    await done([t]);
  }

  if (rejected) warnings.push(`${rejected} opération(s) refusée(s) par le serveur`);
}

interface SimpleSpec {
  local: "budgets" | "alertes" | "recurring" | "scheduled";
  remote: string;
  conflict: string;
  toRemote: (r: Row) => Row;
  fromRemote: (r: Row) => Row;
  columns: string;
}

const SIMPLE: SimpleSpec[] = [
  {
    local: "budgets",
    remote: "budgets",
    conflict: "espace_id,categorie,mois_annee",
    columns: "id, espace_id, categorie, mois_annee, limite",
    toRemote: (r) => ({ id: r.uuid, espace_id: r.espace_id, categorie: r.categorie, mois_annee: r.mois_annee, limite: r.limite }),
    fromRemote: (r) => ({ uuid: r.id, espace_id: r.espace_id, categorie: r.categorie, mois_annee: r.mois_annee, limite: Number(r.limite) }),
  },
  {
    local: "alertes",
    remote: "alertes",
    conflict: "id",
    columns: "id, espace_id, type, seuil, active, cree_le",
    toRemote: (r) => ({ id: r.uuid, espace_id: r.espace_id, type: r.type, seuil: r.seuil, active: r.active }),
    fromRemote: (r) => ({ uuid: r.id, espace_id: r.espace_id, type: r.type, seuil: Number(r.seuil), active: r.active, cree_le: r.cree_le }),
  },
  {
    local: "recurring",
    remote: "transactions_recurrentes",
    conflict: "id",
    columns: "id, espace_id, motif, type_operation, montant, categorie, frequence, date_depart, prochaine_occurrence, actif, auteur_id, cree_le",
    toRemote: (r) => ({
      id: r.uuid, espace_id: r.espace_id, motif: r.motif, type_operation: r.type_operation, montant: r.montant,
      categorie: r.categorie, frequence: r.frequence, date_depart: r.date_depart, prochaine_occurrence: r.prochaine_occurrence,
      actif: r.actif, auteur_id: r.auteur_id, cree_le: r.cree_le,
    }),
    fromRemote: (r) => ({
      uuid: r.id, espace_id: r.espace_id, motif: r.motif, type_operation: r.type_operation, montant: Number(r.montant),
      categorie: r.categorie, frequence: r.frequence, date_depart: r.date_depart, prochaine_occurrence: r.prochaine_occurrence,
      actif: r.actif, auteur_id: r.auteur_id, cree_le: r.cree_le,
    }),
  },
  {
    local: "scheduled",
    remote: "transactions_planifiees",
    conflict: "id",
    columns:
      "id, espace_id, titre, motif, type_operation, montant_prevu, categorie, date_prevue, statut, delai_alerte_jours, auteur_id, cree_le, assigne_a, realisee_par, realisee_le, transaction_client_uuid, annulee_par, annulee_le, motif_annulation",
    // Les champs de trace (realisee_*, annulee_par…) sont écrits par le serveur.
    toRemote: (r) => ({
      id: r.uuid, espace_id: r.espace_id, titre: r.titre, motif: r.motif, type_operation: r.type_operation,
      montant_prevu: r.montant, categorie: r.categorie, date_prevue: r.date_prevue, statut: r.statut,
      delai_alerte_jours: r.alerte_jours_avant, auteur_id: r.auteur_id, cree_le: r.cree_le,
      assigne_a: r.assigne_a ?? null, motif_annulation: r.motif_annulation ?? null,
    }),
    fromRemote: (r) => ({
      uuid: r.id, espace_id: r.espace_id, titre: r.titre, motif: r.motif, type_operation: r.type_operation,
      montant: Number(r.montant_prevu), categorie: r.categorie, date_prevue: r.date_prevue, statut: r.statut,
      alerte_jours_avant: r.delai_alerte_jours, auteur_id: r.auteur_id, cree_le: r.cree_le,
      assigne_a: r.assigne_a ?? null, realisee_par: r.realisee_par ?? null, realisee_le: r.realisee_le ?? null,
      transaction_client_uuid: r.transaction_client_uuid ?? null, annulee_par: r.annulee_par ?? null,
      annulee_le: r.annulee_le ?? null, motif_annulation: r.motif_annulation ?? null,
    }),
  },
];

async function pushSimple(espaceIds: string[], warnings: string[]) {
  let rejected = 0;
  for (const spec of SIMPLE) {
    const table = db[spec.local] as unknown as import("dexie").Table<Row, number>;
    const rows = (await table.where("dirty").equals(1).toArray()).filter((r) => espaceIds.includes(r.espace_id as string));
    for (const r of rows) {
      const { error } = r.deleted
        ? await supabase.from(spec.remote).delete().eq("id", r.uuid as string)
        : await supabase.from(spec.remote).upsert(spec.toRemote(r), { onConflict: spec.conflict });
      if (error && !isRejection(error)) throw new Error(`${spec.remote} : ${error.message}`);
      if (error) rejected++;
      if (r.deleted) await table.delete(r.id as number);
      else await table.update(r.id as number, { dirty: 0 });
    }
  }

  // Paramètres (seuil de validation…)
  const settings = (await db.settings.where("dirty").equals(1).toArray()).filter((s) => espaceIds.includes(s.espace_id));
  for (const s of settings) {
    const { error } = await supabase.from("settings").upsert({ espace_id: s.espace_id, cle: s.cle, valeur: s.valeur }, { onConflict: "espace_id,cle" });
    if (error && !isRejection(error)) throw new Error(`settings : ${error.message}`);
    if (error) rejected++;
    await db.settings.update(s.id!, { dirty: 0 });
  }

  if (rejected) warnings.push(`${rejected} réglage(s) refusé(s) par le serveur`);
}

async function pushCategories(warnings: string[]) {
  const rows = await db.categories.where("dirty").equals(1).toArray();
  let rejected = 0;
  for (const c of rows) {
    let error: { code?: string; message: string } | null = null;
    if (c.deleted) {
      if (c.cloud_id) ({ error } = await supabase.from("categories").delete().eq("id", c.cloud_id));
      await db.categories.delete(c.id!);
    } else if (c.cloud_id) {
      ({ error } = await supabase.from("categories").update({ couleur: c.couleur, icone: c.icone, ordre: c.ordre, active: c.active }).eq("id", c.cloud_id));
      await db.categories.update(c.id!, { dirty: 0 });
    } else {
      ({ error } = await supabase.from("categories").insert({ nom: c.nom, couleur: c.couleur, icone: c.icone, ordre: c.ordre, active: c.active }));
      if (error?.code === "23505") error = null; // existe déjà : la réception fera le lien
      await db.categories.update(c.id!, { dirty: 0 });
    }
    if (error && !isRejection(error)) throw new Error(`categories : ${error.message}`);
    if (error) rejected++;
  }
  if (rejected) warnings.push(`${rejected} catégorie(s) refusée(s)`);
}

// 3. Réception ------------------------------------------------------------------

async function pullTransactions(espaceIds: string[]) {
  const cloud = await fetchAll(
    "transactions",
    "id, client_uuid, date_transaction, motif, type_operation, montant, categorie, statut, auteur_id, cree_le, modifie_le, supprime, espace_id, ordre_id, valide_par, valide_le, supprime_par, motif_refus",
    espaceIds,
  );
  const cloudUuids = new Set(cloud.map((t) => t.client_uuid as string));

  await db.transaction("rw", db.transactions, async () => {
    const local = await db.transactions.where("espace_id").anyOf(espaceIds).toArray();
    const byUuid = new Map(local.map((t) => [t.client_uuid, t]));

    for (const tx of cloud) {
      const existing = byUuid.get(tx.client_uuid as string);
      if (existing?.dirty) continue; // modification locale en attente : elle gagne
      const row: LocalTransaction = {
        client_uuid: tx.client_uuid as string,
        date_transaction: tx.date_transaction as string,
        motif: tx.motif as string,
        type_operation: tx.type_operation as LocalTransaction["type_operation"],
        montant: Number(tx.montant),
        categorie: tx.categorie as string,
        statut: tx.statut as LocalTransaction["statut"],
        auteur_id: tx.auteur_id as string,
        cree_le: tx.cree_le as string,
        modifie_le: (tx.modifie_le as string | null) ?? null,
        supprime: Boolean(tx.supprime),
        espace_id: tx.espace_id as string,
        ordre_id: (tx.ordre_id as string | null) ?? null,
        valide_par: (tx.valide_par as string | null) ?? null,
        valide_le: (tx.valide_le as string | null) ?? null,
        supprime_par: (tx.supprime_par as string | null) ?? null,
        motif_refus: (tx.motif_refus as string | null) ?? null,
        dirty: 0,
      };
      if (existing?.id) await db.transactions.update(existing.id, row);
      else await db.transactions.add(row);
    }

    // Lignes supprimées du cloud (réinitialisation, droits…) et déjà synchronisées.
    const gone = local.filter((t) => !t.dirty && !cloudUuids.has(t.client_uuid)).map((t) => t.id!);
    if (gone.length) await db.transactions.bulkDelete(gone);
  });
}

async function pullSimple(espaceIds: string[]) {
  for (const spec of SIMPLE) {
    const cloud = await fetchAll(spec.remote, spec.columns, espaceIds);
    const table = db[spec.local] as unknown as import("dexie").Table<Row, number>;
    await db.transaction("rw", table, async () => {
      const local = (await table.toArray()).filter((r) => espaceIds.includes(r.espace_id as string));
      const byUuid = new Map(local.map((r) => [r.uuid as string, r]));
      const cloudIds = new Set<string>();
      for (const c of cloud) {
        const mapped = spec.fromRemote(c);
        cloudIds.add(mapped.uuid as string);
        const existing = byUuid.get(mapped.uuid as string);
        if (existing?.dirty) continue;
        if (existing) await table.update(existing.id as number, { ...mapped, dirty: 0, deleted: false });
        else await table.add({ ...mapped, dirty: 0 });
      }
      const gone = local.filter((r) => !r.dirty && !cloudIds.has(r.uuid as string)).map((r) => r.id as number);
      if (gone.length) await table.bulkDelete(gone);
    });
  }

  const { data: settings, error } = await supabase.from("settings").select("cle, valeur, espace_id").in("espace_id", espaceIds);
  if (error) throw new Error(`settings : ${error.message}`);
  await db.transaction("rw", db.settings, async () => {
    for (const s of settings ?? []) {
      const existing = await db.settings.where("[espace_id+cle]").equals([s.espace_id, s.cle]).first();
      if (existing?.dirty) continue;
      if (existing) await db.settings.update(existing.id!, { valeur: s.valeur, dirty: 0 });
      else await db.settings.add({ cle: s.cle, valeur: s.valeur, espace_id: s.espace_id, dirty: 0 });
    }
  });
}

const EVENT_COLUMNS = "id, espace_id, type, acteur_id, acteur_nom, acteur_fonction, cible_id, titre, montant, type_operation, ref_table, ref_id, details, cree_le";
const EVENTS_KEPT_PER_ESPACE = 500;

export function eventFromRemote(r: Row): LocalEvent {
  return {
    id: r.id as string,
    espace_id: r.espace_id as string,
    type: r.type as string,
    acteur_id: (r.acteur_id as string | null) ?? null,
    acteur_nom: (r.acteur_nom as string | null) ?? null,
    acteur_fonction: (r.acteur_fonction as string | null) ?? null,
    cible_id: (r.cible_id as string | null) ?? null,
    titre: (r.titre as string) ?? "",
    montant: r.montant == null ? null : Number(r.montant),
    type_operation: (r.type_operation as LocalEvent["type_operation"]) ?? null,
    ref_table: (r.ref_table as string | null) ?? null,
    ref_id: (r.ref_id as string | null) ?? null,
    details: (r.details as Record<string, unknown> | null) ?? null,
    cree_le: r.cree_le as string,
  };
}

/** Événements récents (incrémental). Silencieux si la migration n'est pas appliquée. */
async function pullEvents(espaceIds: string[]) {
  for (const espaceId of espaceIds) {
    const last = await db.evenements.where("[espace_id+cree_le]").between([espaceId, ""], [espaceId, "\uffff"]).last();
    let q = supabase.from("evenements").select(EVENT_COLUMNS).eq("espace_id", espaceId).order("cree_le", { ascending: false }).limit(EVENTS_KEPT_PER_ESPACE);
    // Petite marge : des événements de la même seconde peuvent arriver en retard.
    if (last) q = q.gte("cree_le", new Date(new Date(last.cree_le).getTime() - 60_000).toISOString());
    const { data, error } = await q;
    if (error) {
      if (/does not exist|could not find the table|schema cache/i.test(error.message)) return;
      throw new Error(`evenements : ${error.message}`);
    }
    if (data?.length) await db.evenements.bulkPut(data.map(eventFromRemote));
    // On ne garde que les plus récents sur l'appareil.
    const count = await db.evenements.where("espace_id").equals(espaceId).count();
    if (count > EVENTS_KEPT_PER_ESPACE) {
      const old = await db.evenements.where("[espace_id+cree_le]").between([espaceId, ""], [espaceId, "\uffff"]).limit(count - EVENTS_KEPT_PER_ESPACE).primaryKeys();
      await db.evenements.bulkDelete(old);
    }
  }
}

async function pullCategories() {
  const { data, error } = await supabase.from("categories").select("id, nom, couleur, icone, ordre, active, user_id");
  if (error) throw new Error(`categories : ${error.message}`);
  const cloud = data ?? [];
  if (cloud.length === 0) return;

  await db.transaction("rw", db.categories, async () => {
    const local = await db.categories.toArray();
    const cloudIds = new Set<number>();
    for (const c of cloud) {
      cloudIds.add(c.id);
      const existing = local.find((l) => l.cloud_id === c.id) ?? local.find((l) => l.nom.toLowerCase() === String(c.nom).toLowerCase());
      if (existing?.dirty) continue;
      const row = { cloud_id: c.id, user_id: c.user_id, nom: c.nom, couleur: c.couleur, icone: c.icone, ordre: c.ordre, active: c.active, dirty: 0 as Dirty };
      if (existing?.id) await db.categories.update(existing.id, row);
      else await db.categories.add(row);
    }
    const gone = local.filter((l) => !l.dirty && l.cloud_id && !cloudIds.has(l.cloud_id)).map((l) => l.id!);
    if (gone.length) await db.categories.bulkDelete(gone);
  });
}
