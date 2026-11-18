/**
 * Ordres de transaction (table `transactions_planifiees`).
 *
 * Circuit type : un admin (ex. « Commissaire aux comptes ») émet un ordre de
 * débit, assigné à un membre (ex. « Trésorier »). L'exécutant clique
 * « Exécuter » : la transaction est créée avec le montant de l'ordre et,
 * l'ordre venant d'un admin, elle est validée d'office au nom de l'émetteur.
 *
 * Les mêmes règles sont appliquées par la base (triggers) : ce module ne fait
 * que refléter localement, tout de suite et hors ligne, ce que le serveur
 * confirmera.
 */
import {
  db,
  dirtyFlag,
  genId,
  isLocalMode,
  notifyDataChanged,
  nowISO,
  uuidFromString,
  type LocalEvent,
  type LocalScheduled,
  type LocalTransaction,
  type Role,
} from "./db";
import { supabase } from "./supabase";
import { formatAriary, formatDate } from "./format";
import { t, type Lang } from "./i18n";

export type Order = LocalScheduled & { id: number };

export interface OrderInput {
  titre: string;
  motif: string;
  categorie: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  date_prevue: string;
  alerte_jours_avant: number;
  assigne_a: string | null;
}

// ---------------------------------------------------------------------------
// Événements locaux (mode sans compte : pas de serveur pour les écrire)
// ---------------------------------------------------------------------------

export async function logLocalEvent(e: {
  espace_id: string;
  type: string;
  acteur_id: string;
  cible_id?: string | null;
  titre: string;
  montant?: number | null;
  type_operation?: "miditra" | "mivoaka" | null;
  ref_table?: string | null;
  ref_id?: string | null;
  details?: Record<string, unknown> | null;
}) {
  if (!isLocalMode()) return; // en ligne : écrit par les triggers SQL (non falsifiable)
  const user = await db.users.get(e.acteur_id);
  const membership = await db.user_espaces.where("[user_id+espace_id]").equals([e.acteur_id, e.espace_id]).first();
  const ev: LocalEvent = {
    id: genId(),
    espace_id: e.espace_id,
    type: e.type,
    acteur_id: e.acteur_id,
    acteur_nom: user?.nom ?? null,
    acteur_fonction: membership?.fonction ?? null,
    cible_id: e.cible_id ?? null,
    titre: e.titre,
    montant: e.montant ?? null,
    type_operation: e.type_operation ?? null,
    ref_table: e.ref_table ?? null,
    ref_id: e.ref_id ?? null,
    details: e.details ?? null,
    cree_le: nowISO(),
  };
  await db.evenements.put(ev);
}

// ---------------------------------------------------------------------------
// Droits (miroir des règles SQL)
// ---------------------------------------------------------------------------

/** Peut exécuter / refuser : exécutant désigné ; si personne n'est désigné, superviseur / admin (ou l'auteur). */
export function canExecute(order: LocalScheduled, me: string, role: Role | null): boolean {
  if (order.statut !== "en_attente") return false;
  if (order.assigne_a) return order.assigne_a === me || role === "admin";
  return role === "admin" || role === "superviseur" || order.auteur_id === me;
}

export function canManage(order: LocalScheduled, me: string, role: Role | null): boolean {
  return role === "admin" || order.auteur_id === me;
}

async function isAdminOf(userId: string, espaceId: string) {
  const m = await db.user_espaces.where("[user_id+espace_id]").equals([userId, espaceId]).first();
  return m?.role_dans_espace === "admin";
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function createOrder(espaceId: string, authorId: string, input: OrderInput) {
  const row: LocalScheduled = {
    uuid: genId(),
    titre: input.titre.trim().slice(0, 255),
    motif: input.motif.trim().slice(0, 255),
    categorie: input.categorie,
    type_operation: input.type_operation,
    montant: input.montant,
    date_prevue: input.date_prevue,
    alerte_jours_avant: input.alerte_jours_avant,
    auteur_id: authorId,
    assigne_a: input.assigne_a,
    statut: "en_attente",
    espace_id: espaceId,
    cree_le: nowISO(),
    dirty: dirtyFlag(),
  };
  await db.scheduled.add(row);
  await logLocalEvent({
    espace_id: espaceId, type: "ordre_cree", acteur_id: authorId, cible_id: input.assigne_a, titre: row.titre,
    montant: row.montant, type_operation: row.type_operation, ref_table: "transactions_planifiees", ref_id: row.uuid,
    details: { date_prevue: row.date_prevue, motif: row.motif },
  });
  notifyDataChanged();
  return row;
}

/**
 * Exécution : crée la transaction liée à l'ordre (identifiant déterministe :
 * deux appareils qui exécutent le même ordre produisent la même ligne).
 */
export async function executeOrder(order: Order, me: string, myRole: Role | null, threshold: number, date: string) {
  const client_uuid = await uuidFromString(`ordre:${order.uuid}`);
  if (await db.transactions.where("client_uuid").equals(client_uuid).count()) return;

  const preAuthorized = await isAdminOf(order.auteur_id, order.espace_id);
  const isAdmin = myRole === "admin";
  const statut: LocalTransaction["statut"] = preAuthorized || isAdmin || order.montant < threshold ? "validee" : "en_attente_validation";
  const now = nowISO();

  await db.transaction("rw", [db.transactions, db.scheduled], async () => {
    await db.transactions.add({
      client_uuid,
      date_transaction: date,
      motif: (order.motif || order.titre).slice(0, 255),
      type_operation: order.type_operation,
      montant: order.montant,
      categorie: order.categorie,
      statut,
      auteur_id: me,
      cree_le: now,
      modifie_le: null,
      supprime: false,
      espace_id: order.espace_id,
      ordre_id: order.uuid,
      valide_par: preAuthorized ? order.auteur_id : isAdmin ? me : null,
      valide_le: statut === "validee" ? now : null,
      dirty: dirtyFlag(),
    });
    // En ligne, c'est le serveur qui clôt l'ordre (on n'envoie donc pas ce changement).
    await db.scheduled.update(order.id, {
      statut: "realisee",
      realisee_par: me,
      realisee_le: now,
      transaction_client_uuid: client_uuid,
      dirty: 0,
    });
  });
  await logLocalEvent({
    espace_id: order.espace_id, type: "ordre_execute", acteur_id: me, cible_id: order.auteur_id, titre: order.titre,
    montant: order.montant, type_operation: order.type_operation, ref_table: "transactions_planifiees", ref_id: order.uuid,
  });
  notifyDataChanged();
}

/** Refus par l'exécutant : nécessite le serveur en mode compte (motif obligatoire). */
export async function refuseOrder(order: Order, me: string, motif: string) {
  const reason = motif.trim().slice(0, 500);
  if (!reason) throw new Error("Motif du refus obligatoire");
  if (!isLocalMode()) {
    if (!navigator.onLine) throw new Error("Connexion Internet requise pour refuser un ordre");
    const { error } = await supabase.rpc("refuser_ordre", { p_ordre_id: order.uuid, p_motif: reason });
    if (error) throw new Error(error.message);
  }
  await db.scheduled.update(order.id, { statut: "refusee", annulee_par: me, annulee_le: nowISO(), motif_annulation: reason, dirty: 0 });
  await logLocalEvent({
    espace_id: order.espace_id, type: "ordre_refuse", acteur_id: me, cible_id: order.auteur_id, titre: order.titre,
    montant: order.montant, type_operation: order.type_operation, ref_table: "transactions_planifiees", ref_id: order.uuid,
    details: { motif: reason },
  });
  notifyDataChanged();
}

/** Annulation par l'émetteur ou un admin. */
export async function cancelOrder(order: Order, me: string, motif: string) {
  const reason = motif.trim().slice(0, 500) || null;
  await db.scheduled.update(order.id, { statut: "annulee", annulee_par: me, annulee_le: nowISO(), motif_annulation: reason, dirty: dirtyFlag() });
  await logLocalEvent({
    espace_id: order.espace_id, type: "ordre_annule", acteur_id: me, cible_id: order.assigne_a ?? null, titre: order.titre,
    montant: order.montant, type_operation: order.type_operation, ref_table: "transactions_planifiees", ref_id: order.uuid,
    details: { motif: reason },
  });
  notifyDataChanged();
}

/** Remise en attente d'un ordre annulé ou refusé. */
export async function reopenOrder(order: Order, me: string) {
  await db.scheduled.update(order.id, { statut: "en_attente", annulee_par: null, annulee_le: null, motif_annulation: null, dirty: dirtyFlag() });
  await logLocalEvent({
    espace_id: order.espace_id, type: "ordre_rouvert", acteur_id: me, cible_id: order.assigne_a ?? null, titre: order.titre,
    montant: order.montant, type_operation: order.type_operation, ref_table: "transactions_planifiees", ref_id: order.uuid,
  });
  notifyDataChanged();
}

// ---------------------------------------------------------------------------
// Texte des événements
// ---------------------------------------------------------------------------

export type EventTone = "action" | "ok" | "warn" | "info";

const TONES: Record<string, EventTone> = {
  ordre_cree: "action",
  saisie_a_valider: "action",
  ordre_execute: "ok",
  transaction_validee: "ok",
  membre_ajoute: "info",
  ordre_refuse: "warn",
  ordre_annule: "warn",
  transaction_refusee: "warn",
  transaction_supprimee: "warn",
};

export function eventTone(type: string): EventTone {
  return TONES[type] ?? "info";
}

/** Libellé lisible : « Rabe (Trésorier) a exécuté l'ordre « Loyer » — 250 000 Ar ». */
export function describeEvent(ev: LocalEvent, lang: Lang, names: Map<string, string>, me?: string): string {
  const who = (id: string | null, fallback?: string | null, fonction?: string | null) => {
    const n = (id && names.get(id)) || fallback || t(lang, "evSomeone");
    const label = fonction ? `${n} (${fonction})` : n;
    // « Rabe (vous) a exécuté… » : évite les fautes d'accord avec « Vous ».
    return id && id === me ? `${label} (${t(lang, "you")})` : label;
  };
  const d = ev.details ?? {};
  const vars: Record<string, string> = {
    actor: who(ev.acteur_id, ev.acteur_nom, ev.acteur_fonction),
    target: ev.cible_id ? who(ev.cible_id) : t(lang, "evAnyTreasurer"),
    title: ev.titre || "—",
    amount: ev.montant != null ? formatAriary(ev.montant, lang) : "",
    kind: ev.type_operation === "miditra" ? t(lang, "evCredit") : t(lang, "evDebit"),
    date: typeof d.date_prevue === "string" ? formatDate(d.date_prevue, lang) : "",
    reason: typeof d.motif === "string" && d.motif ? d.motif : t(lang, "evNoReason"),
    role: typeof d.role === "string" ? t(lang, d.role === "operateur" ? "operator" : d.role) : "",
    fonction: typeof d.fonction === "string" && d.fonction ? ` — ${d.fonction}` : "",
  };
  const key = `ev_${ev.type}`;
  const text = t(lang, key, vars);
  return text === key ? `${vars.actor} · ${ev.type} · ${vars.title}` : text;
}
