import Dexie, { type Table } from "dexie";

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
  espace_id?: string;
}

export interface LocalUser {
  id: string;
  nom: string;
  email: string;
  password: string;
  role: "operateur" | "admin" | "superviseur";
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
  role_dans_espace: "operateur" | "admin" | "superviseur";
}

export interface LocalBudget {
  id?: number;
  categorie: string;
  mois_annee: string;
  limite: number;
  espace_id: string;
}

export interface LocalAlerte {
  id?: number;
  type: "solde_bas" | "grosse_depense";
  seuil: number;
  active: boolean;
  espace_id: string;
}

export interface LocalAudit {
  id?: number;
  action: string;
  table_concernee: string;
  enregistrement_id: string;
  ancienne_valeur: string | null;
  nouvelle_valeur: string | null;
  auteur_id: string;
  date_action: string;
  espace_id: string;
}

export interface LocalRecurring {
  id?: number;
  motif: string;
  type_operation: "miditra" | "mivoaka";
  montant: number;
  categorie: string;
  frequence: "quotidien" | "hebdomadaire" | "mensuel" | "annuel";
  date_debut: string;
  prochaine_occurrence: string;
  actif: boolean;
  auteur_id: string;
  espace_id: string;
  cree_le: string;
}

export interface LocalScheduled {
  id?: number;
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
}

export interface LocalSetting {
  cle: string;
  valeur: string;
  espace_id: string;
}

export interface LocalCategory {
  id?: number;
  nom: string;
  couleur: string;
  icone: string;
  ordre: number;
  active: boolean;
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

  constructor() {
    super("mtantana");
    this.version(5).stores({
      transactions: "++id, client_uuid, date_transaction, type_operation, categorie, statut, auteur_id, supprime, espace_id",
      users: "id, email, role, actif",
      espaces: "id, nom",
      user_espaces: "++id, user_id, espace_id, role_dans_espace",
      budgets: "++id, categorie, mois_annee, espace_id",
      alertes: "++id, type, active, espace_id",
      journal_audit: "++id, action, auteur_id, date_action, espace_id",
      recurring: "++id, actif, espace_id, auteur_id",
      scheduled: "++id, statut, espace_id, auteur_id, date_prevue",
      settings: "++id, cle, espace_id",
      categories: "++id, nom, ordre, active",
    });
  }
}

export const db = new BudgetDB();

export function genClientUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function genId(): string {
  return genClientUuid();
}

export async function deduplicateLocalDb(): Promise<void> {
  const all = await db.transactions.toArray();
  const seen = new Set<string>();
  const toDelete: number[] = [];
  for (const row of all) {
    if (seen.has(row.client_uuid)) {
      if (row.id) toDelete.push(row.id);
    } else {
      seen.add(row.client_uuid);
    }
  }
  if (toDelete.length > 0) {
    await db.transactions.bulkDelete(toDelete);
  }
}

const DEFAULT_CATEGORIES: LocalCategory[] = [
  { nom: "autre", couleur: "#64748b", icone: "Tag", ordre: 1, active: true },
  { nom: "sakafo", couleur: "#10b981", icone: "Utensils", ordre: 2, active: true },
  { nom: "transport", couleur: "#3b82c6", icone: "Car", ordre: 3, active: true },
  { nom: "loyer", couleur: "#f59e0b", icone: "Home", ordre: 4, active: true },
  { nom: "salaire", couleur: "#22c55e", icone: "Wallet", ordre: 5, active: true },
  { nom: "fournitures", couleur: "#8b5cf6", icone: "Package", ordre: 6, active: true },
  { nom: "factures", couleur: "#ef4444", icone: "FileText", ordre: 7, active: true },
  { nom: "loisirs", couleur: "#ec4899", icone: "Gamepad2", ordre: 8, active: true },
  { nom: "sante", couleur: "#06b6d4", icone: "HeartPulse", ordre: 9, active: true },
];

export async function ensureSeedData(): Promise<void> {
  const catCount = await db.categories.count();
  if (catCount === 0) {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES);
  }
  const settingCount = await db.settings.count();
  if (settingCount === 0) {
    // No default settings — they'll be created on demand
  }
}

export async function clearAllData(): Promise<void> {
  await db.transactions.clear();
  await db.budgets.clear();
  await db.alertes.clear();
  await db.journal_audit.clear();
  await db.recurring.clear();
  await db.scheduled.clear();
  await db.settings.clear();
  await db.categories.clear();
  await db.espaces.clear();
  await db.user_espaces.clear();
}

function stripIds<T extends Record<string, unknown>>(rows: T[]): T[] {
  return rows.map((r) => {
    const { id, ...rest } = r;
    return rest as T;
  });
}

export async function exportAllData(): Promise<string> {
  const [transactions, users, espaces, user_espaces, budgets, alertes, journal_audit, recurring, scheduled, settings, categories] = await Promise.all([
    db.transactions.toArray(),
    db.users.toArray(),
    db.espaces.toArray(),
    db.user_espaces.toArray(),
    db.budgets.toArray(),
    db.alertes.toArray(),
    db.journal_audit.toArray(),
    db.recurring.toArray(),
    db.scheduled.toArray(),
    db.settings.toArray(),
    db.categories.toArray(),
  ]);

  return JSON.stringify({
    version: 1,
    exportDate: new Date().toISOString(),
    transactions,
    users,
    espaces,
    user_espaces,
    budgets,
    alertes,
    journal_audit,
    recurring,
    scheduled,
    settings,
    categories,
  }, null, 2);
}

export async function importAllData(json: string, replaceUsers: boolean = false): Promise<void> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new Error("Le fichier n'est pas un JSON valide");
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Le format de sauvegarde est invalide");
  }

  const requiredArrays = ["transactions", "users", "espaces", "user_espaces", "budgets", "alertes", "journal_audit", "recurring", "scheduled", "settings", "categories"];
  for (const key of requiredArrays) {
    if (data[key] !== undefined && !Array.isArray(data[key])) {
      throw new Error(`La section ${key} est invalide`);
    }
  }

  if (!Array.isArray(data.transactions) || !Array.isArray(data.espaces) || !Array.isArray(data.categories)) {
    throw new Error("Ce fichier ne correspond pas à une sauvegarde M'tantana");
  }

  await clearAllData();

  if (data.categories && data.categories.length > 0) {
    await db.categories.bulkAdd(stripIds(data.categories));
  } else {
    await db.categories.bulkAdd(DEFAULT_CATEGORIES);
  }

  if (data.transactions) await db.transactions.bulkAdd(stripIds(data.transactions));
  if (data.espaces) await db.espaces.bulkAdd(data.espaces);
  if (data.user_espaces) await db.user_espaces.bulkAdd(stripIds(data.user_espaces));
  if (data.budgets) await db.budgets.bulkAdd(stripIds(data.budgets));
  if (data.alertes) await db.alertes.bulkAdd(stripIds(data.alertes));
  if (data.journal_audit) await db.journal_audit.bulkAdd(stripIds(data.journal_audit));
  if (data.recurring) await db.recurring.bulkAdd(stripIds(data.recurring));
  if (data.scheduled) await db.scheduled.bulkAdd(stripIds(data.scheduled));
  if (data.settings) await db.settings.bulkAdd(stripIds(data.settings));

  if (replaceUsers && data.users) {
    await db.users.clear();
    await db.users.bulkAdd(data.users);
  }
}
