import Dexie, { type Table } from "dexie";

/**
 * Base locale (IndexedDB via Dexie).
 *
 * - Une base PAR compte (`mtantana_u_<uid>`) et une base dédiée au mode sans
 *   compte (`mtantana_local`) : deux personnes qui partagent un appareil ne
 *   voient jamais les données l'une de l'autre.
 * - `dirty = 1` : ligne modifiée localement, pas encore envoyée au cloud.
 * - `deleted = true` : suppression en attente d'envoi (tombstone).
 */

export type Dirty = 0 | 1;
export type Role = "operateur" | "admin" | "superviseur";

export interface LocalTransaction {
  id?: number;
  client_uuid: string;
  date_transaction: string;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
  statut: "validee" | "en_attente_validation";
  auteur_id: string;
  cree_le: string;
  modifie_le?: string | null;
  supprime: boolean;
  espace_id: string;
  dirty?: Dirty;
}

export interface LocalUser {
  id: string;
  nom: string;
  email: string;
  role: Role;
  langue: "fr" | "mg";
  actif: boolean;
  cree_le: string;
}

export interface LocalEspace {
  id: string;
  nom: string;
  cree_le: string;
}

export interface LocalUserEspace {
  id?: number;
  user_id: string;
  espace_id: string;
  role_dans_espace: Role;
}

export interface LocalBudget {
  id?: number;
  uuid: string;
  categorie: string;
  mois_annee: string;
  limite: number;
  espace_id: string;
  dirty?: Dirty;
  deleted?: boolean;
}

export interface LocalAlerte {
  id?: number;
  uuid: string;
  type: "solde_bas" | "grosse_depense";
  seuil: number;
  active: boolean;
  espace_id: string;
  cree_le?: string;
  dirty?: Dirty;
  deleted?: boolean;
}

export interface LocalAudit {
  id?: number;
  cloud_id?: string;
  action: string;
  table_concernee: string;
  enregistrement_id: string;
  ancienne_valeur: string | null;
  nouvelle_valeur: string | null;
  auteur_id: string;
  date_action: string;
  espace_id: string;
}

export type Frequence = "quotidien" | "hebdomadaire" | "mensuel" | "annuel";

export interface LocalRecurring {
  id?: number;
  uuid: string;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
  frequence: Frequence;
  date_depart: string;
  prochaine_occurrence: string;
  actif: boolean;
  auteur_id: string;
  espace_id: string;
  cree_le: string;
  dirty?: Dirty;
  deleted?: boolean;
}

export interface LocalScheduled {
  id?: number;
  uuid: string;
  titre: string;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
  date_prevue: string;
  statut: "en_attente" | "realisee" | "annulee";
  alerte_jours_avant: number;
  auteur_id: string;
  espace_id: string;
  cree_le: string;
  dirty?: Dirty;
  deleted?: boolean;
}

export interface LocalSetting {
  id?: number;
  cle: string;
  valeur: string;
  espace_id: string;
  dirty?: Dirty;
}

export interface LocalCategory {
  id?: number;
  cloud_id?: number | null;
  user_id?: string | null;
  nom: string;
  couleur: string;
  icone: string;
  ordre: number;
  active: boolean;
  dirty?: Dirty;
  deleted?: boolean;
}

class BudgetDB extends Dexie {
  transactions!: Table<LocalTransaction, number>;
  users!: Table<LocalUser, string>;
  espaces!: Table<LocalEspace, string>;
  user_espaces!: Table<LocalUserEspace, number>;
  budgets!: Table<LocalBudget, number>;
  alertes!: Table<LocalAlerte, number>;
  journal_audit!: Table<LocalAudit, number>;
  recurring!: Table<LocalRecurring, number>;
  scheduled!: Table<LocalScheduled, number>;
  settings!: Table<LocalSetting, number>;
  categories!: Table<LocalCategory, number>;

  constructor(name: string) {
    super(name);
    this.version(6).stores({
      transactions: "++id, &client_uuid, date_transaction, espace_id, auteur_id, dirty",
      users: "id, email",
      espaces: "id",
      user_espaces: "++id, user_id, espace_id, [user_id+espace_id]",
      budgets: "++id, &uuid, espace_id, dirty",
      alertes: "++id, &uuid, espace_id, dirty",
      journal_audit: "++id, cloud_id, espace_id, date_action",
      recurring: "++id, &uuid, espace_id, auteur_id, dirty",
      scheduled: "++id, &uuid, espace_id, auteur_id, dirty",
      settings: "++id, [espace_id+cle], espace_id, dirty",
      categories: "++id, nom, ordre, cloud_id, dirty",
    });
  }
}

export const LOCAL_DB_NAME = "mtantana_local";
const LEGACY_DB_NAME = "mtantana";

/**
 * Instance courante. Les modules importent `db` : c'est une liaison ES
 * « vivante », elle suit donc la base ouverte par `openDatabaseFor`.
 */
export let db = new BudgetDB("mtantana_guest");
let localMode = false;

export function isLocalMode() {
  return localMode;
}

export function userDbName(uid: string) {
  return `mtantana_u_${uid}`;
}

/** Ouvre la base du compte `uid` (ou la base du mode local). */
let opening: { name: string; promise: Promise<void> } | null = null;

export async function openDatabaseFor(uid: string | null): Promise<void> {
  const name = uid ? userDbName(uid) : LOCAL_DB_NAME;
  localMode = uid === null;
  if (opening?.name === name) return opening.promise;
  if (db.name === name && db.isOpen()) return;
  const promise = (async () => {
    db.close();
    db = new BudgetDB(name);
    await db.open();
    if (uid) await migrateLegacyDatabase(uid);
    await ensureSeedData();
  })();
  opening = { name, promise };
  try {
    await promise;
  } finally {
    if (opening?.promise === promise) opening = null;
  }
}

// ---------------------------------------------------------------------------
// Migration depuis l'ancienne base unique « mtantana » (versions ≤ 5).
// Elle n'est reprise que par le compte à qui elle appartient.
// ---------------------------------------------------------------------------
async function migrateLegacyDatabase(uid: string) {
  try {
    if (!(await Dexie.exists(LEGACY_DB_NAME))) return;
    const legacy = new Dexie(LEGACY_DB_NAME);
    await legacy.open(); // ouverture dynamique, sans déclarer le schéma
    const tableNames = legacy.tables.map((t) => t.name);
    const read = async (name: string) =>
      tableNames.includes(name) ? ((await legacy.table(name).toArray()) as Record<string, unknown>[]) : [];

    const [txs, ues] = await Promise.all([read("transactions"), read("user_espaces")]);
    const belongs = txs.some((t) => t.auteur_id === uid) || ues.some((u) => u.user_id === uid);
    if (!belongs) {
      legacy.close();
      return;
    }

    const [espaces, budgets, alertes, recurring, scheduled, categories] = await Promise.all([
      read("espaces"), read("budgets"), read("alertes"), read("recurring"), read("scheduled"), read("categories"),
    ]);

    await db.transaction("rw", [db.transactions, db.espaces, db.budgets, db.alertes, db.recurring, db.scheduled, db.categories], async () => {
      for (const t of txs) {
        if (!t.client_uuid || !t.espace_id) continue;
        if (await db.transactions.where("client_uuid").equals(String(t.client_uuid)).count()) continue;
        const { id: _id, ...rest } = t;
        void _id;
        await db.transactions.add({ ...(rest as unknown as LocalTransaction), dirty: t.auteur_id === uid ? 1 : 0 });
      }
      for (const e of espaces) await db.espaces.put(e as unknown as LocalEspace);
      for (const b of budgets) {
        if (!b.espace_id) continue;
        await db.budgets.add({ uuid: genId(), categorie: String(b.categorie), mois_annee: String(b.mois_annee), limite: Number(b.limite), espace_id: String(b.espace_id), dirty: 1 });
      }
      for (const a of alertes) {
        if (!a.espace_id) continue;
        await db.alertes.add({ uuid: genId(), type: a.type as LocalAlerte["type"], seuil: Number(a.seuil), active: Boolean(a.active), espace_id: String(a.espace_id), dirty: 1 });
      }
      for (const r of recurring) {
        if (!r.espace_id) continue;
        await db.recurring.add({
          uuid: genId(),
          motif: String(r.motif ?? ""),
          type_operation: r.type_operation as LocalRecurring["type_operation"],
          montant: Number(r.montant),
          categorie: String(r.categorie ?? "autre"),
          frequence: r.frequence as Frequence,
          date_depart: String(r.date_depart ?? r.date_debut ?? todayISO()),
          prochaine_occurrence: String(r.prochaine_occurrence ?? todayISO()),
          actif: r.actif !== false,
          auteur_id: String(r.auteur_id ?? uid),
          espace_id: String(r.espace_id),
          cree_le: String(r.cree_le ?? nowISO()),
          dirty: 1,
        });
      }
      for (const s of scheduled) {
        if (!s.espace_id) continue;
        await db.scheduled.add({
          uuid: genId(),
          titre: String(s.titre ?? ""),
          motif: String(s.motif ?? ""),
          type_operation: s.type_operation as LocalScheduled["type_operation"],
          montant: Number(s.montant ?? 0),
          categorie: String(s.categorie ?? "autre"),
          date_prevue: String(s.date_prevue),
          statut: (s.statut as LocalScheduled["statut"]) ?? "en_attente",
          alerte_jours_avant: Number(s.alerte_jours_avant ?? 1),
          auteur_id: String(s.auteur_id ?? uid),
          espace_id: String(s.espace_id),
          cree_le: String(s.cree_le ?? nowISO()),
          dirty: 1,
        });
      }
      for (const c of categories) {
        const nom = String(c.nom ?? "").trim();
        if (!nom || (await db.categories.where("nom").equals(nom).count())) continue;
        await db.categories.add({ nom, couleur: String(c.couleur ?? "#64748b"), icone: String(c.icone ?? "Tag"), ordre: Number(c.ordre ?? 99), active: c.active !== false, dirty: 1 });
      }
    });

    legacy.close();
    await Dexie.delete(LEGACY_DB_NAME);
  } catch (err) {
    console.warn("[db] migration de l'ancienne base impossible :", err);
  }
}

// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------

export function genClientUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return bytesToUuid(bytes);
}

export const genId = genClientUuid;

function bytesToUuid(b: Uint8Array): string {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** UUID déterministe (même entrée → même UUID) : évite les doublons multi-appareils. */
export async function uuidFromString(input: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input)));
  const b = hash.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  return bytesToUuid(b);
}

export function nowISO() {
  return new Date().toISOString();
}

/** Date du jour en heure LOCALE (et non UTC) au format AAAA-MM-JJ. */
export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Signale aux pages et à la synchro que des données locales ont changé. */
export function notifyDataChanged() {
  window.dispatchEvent(new CustomEvent("mtantana:data-changed"));
}

export async function countPending(): Promise<number> {
  const counts = await Promise.all([
    db.transactions.where("dirty").equals(1).count(),
    db.budgets.where("dirty").equals(1).count(),
    db.alertes.where("dirty").equals(1).count(),
    db.recurring.where("dirty").equals(1).count(),
    db.scheduled.where("dirty").equals(1).count(),
    db.settings.where("dirty").equals(1).count(),
    db.categories.where("dirty").equals(1).count(),
  ]);
  return counts.reduce((a, b) => a + b, 0);
}

type SoftTable = "budgets" | "alertes" | "recurring" | "scheduled" | "categories";

/** Modification locale + marquage « à synchroniser ». */
export async function updateDirty<T extends SoftTable>(table: T, id: number, changes: Record<string, unknown>) {
  await (db[table] as unknown as Table<Record<string, unknown>, number>).update(id, { ...changes, dirty: localMode ? 0 : 1 });
  notifyDataChanged();
}

/** Suppression : immédiate en mode local, différée (tombstone) en mode cloud. */
export async function removeDirty(table: SoftTable, id: number) {
  const tbl = db[table] as unknown as Table<Record<string, unknown>, number>;
  if (localMode) await tbl.delete(id);
  else await tbl.update(id, { deleted: true, dirty: 1 });
  notifyDataChanged();
}

export function dirtyFlag(): Dirty {
  return localMode ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Catégories par défaut
// ---------------------------------------------------------------------------

export const DEFAULT_CATEGORIES: Omit<LocalCategory, "id">[] = [
  { nom: "autre", couleur: "#64748b", icone: "Tag", ordre: 1, active: true },
  { nom: "sakafo", couleur: "#10b981", icone: "Utensils", ordre: 2, active: true },
  { nom: "transport", couleur: "#3b82f6", icone: "Car", ordre: 3, active: true },
  { nom: "loyer", couleur: "#f59e0b", icone: "Home", ordre: 4, active: true },
  { nom: "salaire", couleur: "#22c55e", icone: "Wallet", ordre: 5, active: true },
  { nom: "fournitures", couleur: "#8b5cf6", icone: "Package", ordre: 6, active: true },
  { nom: "factures", couleur: "#ef4444", icone: "FileText", ordre: 7, active: true },
  { nom: "loisirs", couleur: "#ec4899", icone: "Gamepad2", ordre: 8, active: true },
  { nom: "sante", couleur: "#06b6d4", icone: "HeartPulse", ordre: 9, active: true },
];

export async function ensureSeedData(): Promise<void> {
  if ((await db.categories.count()) === 0) {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((c) => ({ ...c, dirty: 0 as Dirty })));
  }
}

/** Efface toutes les données d'un espace sur cet appareil. */
export async function purgeEspaceLocal(espaceId: string, opts: { keepEspace?: boolean } = {}) {
  await db.transaction("rw", [db.transactions, db.budgets, db.alertes, db.journal_audit, db.recurring, db.scheduled, db.settings, db.user_espaces, db.espaces], async () => {
    await db.transactions.where("espace_id").equals(espaceId).delete();
    await db.budgets.where("espace_id").equals(espaceId).delete();
    await db.alertes.where("espace_id").equals(espaceId).delete();
    await db.journal_audit.where("espace_id").equals(espaceId).delete();
    await db.recurring.where("espace_id").equals(espaceId).delete();
    await db.scheduled.where("espace_id").equals(espaceId).delete();
    if (!opts.keepEspace) {
      await db.settings.where("espace_id").equals(espaceId).delete();
      await db.user_espaces.where("espace_id").equals(espaceId).delete();
      await db.espaces.delete(espaceId);
    }
  });
}

/** Supprime complètement une base de cet appareil. */
export async function deleteLocalDatabase(name: string) {
  if (db.name === name) db.close();
  await Dexie.delete(name);
}

export async function localDatabaseHasData(name: string): Promise<boolean> {
  if (!(await Dexie.exists(name))) return false;
  const other = new BudgetDB(name);
  try {
    await other.open();
    return (await other.transactions.count()) > 0;
  } finally {
    other.close();
  }
}

// ---------------------------------------------------------------------------
// Sauvegarde / restauration (fichier JSON, Google Drive)
// ---------------------------------------------------------------------------

export interface BackupData {
  app: "mtantana";
  version: 2;
  exportDate: string;
  espaces: LocalEspace[];
  transactions: LocalTransaction[];
  budgets: LocalBudget[];
  alertes: LocalAlerte[];
  recurring: LocalRecurring[];
  scheduled: LocalScheduled[];
  settings: LocalSetting[];
  categories: LocalCategory[];
}

function stripLocal<T extends object>(rows: T[]): T[] {
  return rows.map((r) => {
    const { id: _id, dirty: _d, ...rest } = r as T & { id?: unknown; dirty?: unknown };
    void _id;
    void _d;
    return rest as T;
  });
}

export async function exportAllData(): Promise<string> {
  const notDeleted = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted);
  const data: BackupData = {
    app: "mtantana",
    version: 2,
    exportDate: nowISO(),
    espaces: await db.espaces.toArray(),
    transactions: stripLocal(await db.transactions.toArray()),
    budgets: stripLocal(notDeleted(await db.budgets.toArray())),
    alertes: stripLocal(notDeleted(await db.alertes.toArray())),
    recurring: stripLocal(notDeleted(await db.recurring.toArray())),
    scheduled: stripLocal(notDeleted(await db.scheduled.toArray())),
    settings: stripLocal(await db.settings.toArray()),
    categories: stripLocal(notDeleted(await db.categories.toArray())).map((c) => ({ ...c, cloud_id: null })),
  };
  return JSON.stringify(data, null, 2);
}

const MAX_BACKUP_ROWS = 200_000;

function str(v: unknown, max = 255): string {
  return String(v ?? "").slice(0, max);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function isoDate(v: unknown): string {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : todayISO();
}
function arr(data: Record<string, unknown>, key: string): Record<string, unknown>[] {
  const v = data[key];
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new Error(`La section « ${key} » de la sauvegarde est invalide`);
  if (v.length > MAX_BACKUP_ROWS) throw new Error("Sauvegarde trop volumineuse");
  return v.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
}

export function parseBackup(json: string): Record<string, unknown> {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("Le fichier n'est pas un JSON valide");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Format de sauvegarde invalide");
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.transactions) || !Array.isArray(d.espaces)) {
    throw new Error("Ce fichier n'est pas une sauvegarde M'tantana");
  }
  return d;
}

/**
 * Restaure une sauvegarde.
 * - `replace` (mode local) : remplace toutes les données de l'appareil.
 * - `merge` (mode cloud, ou import dans un espace) : ajoute les éléments
 *   manquants dans l'espace `targetEspaceId`, au nom de `userId`.
 */
export async function importBackup(
  json: string,
  opts: { strategy: "replace" | "merge"; targetEspaceId?: string; userId: string },
): Promise<{ transactions: number }> {
  const data = parseBackup(json);
  const txs = arr(data, "transactions");
  const espaces = arr(data, "espaces");
  const merge = opts.strategy === "merge";
  const target = opts.targetEspaceId;
  if (merge && !target) throw new Error("Aucun espace sélectionné");
  const flag = dirtyFlag();
  const espaceFor = (v: unknown) => (merge ? target! : str(v, 64));
  let imported = 0;

  await db.transaction("rw", [db.transactions, db.espaces, db.user_espaces, db.budgets, db.alertes, db.recurring, db.scheduled, db.settings, db.categories], async () => {
    if (!merge) {
      await Promise.all([
        db.transactions.clear(), db.espaces.clear(), db.user_espaces.clear(), db.budgets.clear(), db.alertes.clear(),
        db.recurring.clear(), db.scheduled.clear(), db.settings.clear(), db.categories.clear(),
      ]);
      for (const e of espaces) {
        const id = str(e.id, 64);
        if (!id) continue;
        await db.espaces.put({ id, nom: str(e.nom, 100) || "Mon espace", cree_le: str(e.cree_le, 40) || nowISO() });
        await db.user_espaces.add({ user_id: opts.userId, espace_id: id, role_dans_espace: "admin" });
      }
    }

    for (const t of txs) {
      const client_uuid = str(t.client_uuid, 64);
      const type = t.type_operation === "miditra" ? "miditra" : t.type_operation === "mivoaka" ? "mivoaka" : null;
      const montant = num(t.montant);
      if (!client_uuid || !type || montant <= 0) continue;
      if (merge && (await db.transactions.where("client_uuid").equals(client_uuid).count())) continue;
      await db.transactions.add({
        client_uuid,
        date_transaction: isoDate(t.date_transaction),
        motif: str(t.motif) || "—",
        type_operation: type,
        montant,
        categorie: str(t.categorie, 40) || "autre",
        statut: t.statut === "en_attente_validation" ? "en_attente_validation" : "validee",
        auteur_id: merge ? opts.userId : str(t.auteur_id, 64) || opts.userId,
        cree_le: str(t.cree_le, 40) || nowISO(),
        modifie_le: t.modifie_le ? str(t.modifie_le, 40) : null,
        supprime: t.supprime === true,
        espace_id: espaceFor(t.espace_id),
        dirty: flag,
      });
      imported++;
    }

    for (const b of arr(data, "budgets")) {
      await db.budgets.add({ uuid: genId(), categorie: str(b.categorie, 40), mois_annee: str(b.mois_annee, 7), limite: num(b.limite), espace_id: espaceFor(b.espace_id), dirty: flag });
    }
    for (const a of arr(data, "alertes")) {
      await db.alertes.add({ uuid: genId(), type: a.type === "grosse_depense" ? "grosse_depense" : "solde_bas", seuil: num(a.seuil), active: a.active !== false, espace_id: espaceFor(a.espace_id), dirty: flag });
    }
    for (const r of arr(data, "recurring")) {
      await db.recurring.add({
        uuid: genId(), motif: str(r.motif), type_operation: r.type_operation === "miditra" ? "miditra" : "mivoaka",
        montant: num(r.montant), categorie: str(r.categorie, 40) || "autre",
        frequence: (["quotidien", "hebdomadaire", "mensuel", "annuel"].includes(String(r.frequence)) ? r.frequence : "mensuel") as Frequence,
        date_depart: isoDate(r.date_depart ?? r.date_debut), prochaine_occurrence: isoDate(r.prochaine_occurrence),
        actif: r.actif !== false, auteur_id: opts.userId, espace_id: espaceFor(r.espace_id), cree_le: str(r.cree_le, 40) || nowISO(), dirty: flag,
      });
    }
    for (const s of arr(data, "scheduled")) {
      await db.scheduled.add({
        uuid: genId(), titre: str(s.titre), motif: str(s.motif), type_operation: s.type_operation === "miditra" ? "miditra" : "mivoaka",
        montant: num(s.montant), categorie: str(s.categorie, 40) || "autre", date_prevue: isoDate(s.date_prevue),
        statut: (["en_attente", "realisee", "annulee"].includes(String(s.statut)) ? s.statut : "en_attente") as LocalScheduled["statut"],
        alerte_jours_avant: Math.max(0, Math.round(num(s.alerte_jours_avant))), auteur_id: opts.userId,
        espace_id: espaceFor(s.espace_id), cree_le: str(s.cree_le, 40) || nowISO(), dirty: flag,
      });
    }
    if (!merge) {
      for (const s of arr(data, "settings")) {
        await db.settings.add({ cle: str(s.cle, 50), valeur: str(s.valeur, 500), espace_id: str(s.espace_id, 64), dirty: 0 });
      }
    }
    for (const c of arr(data, "categories")) {
      const nom = str(c.nom, 40).trim();
      if (!nom || (await db.categories.where("nom").equals(nom).count())) continue;
      await db.categories.add({ nom, couleur: /^#[0-9a-f]{6}$/i.test(String(c.couleur)) ? String(c.couleur) : "#64748b", icone: str(c.icone, 40) || "Tag", ordre: num(c.ordre), active: c.active !== false, dirty: flag });
    }
    if ((await db.categories.count()) === 0) {
      await db.categories.bulkAdd(DEFAULT_CATEGORIES.map((c) => ({ ...c, dirty: flag })));
    }
  });

  notifyDataChanged();
  return { transactions: imported };
}

/** Copie les données du mode sans compte vers l'espace cloud courant. */
export async function copyLocalModeDataInto(targetEspaceId: string, userId: string) {
  const source = new BudgetDB(LOCAL_DB_NAME);
  await source.open();
  const previous = db;
  try {
    db = source;
    const json = await exportAllData();
    db = previous;
    return await importBackup(json, { strategy: "merge", targetEspaceId, userId });
  } finally {
    db = previous;
    source.close();
  }
}
