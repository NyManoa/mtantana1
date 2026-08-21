import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { db, deduplicateLocalDb, genClientUuid } from "./db";

export interface SyncState {
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSync: string | null;
  error: string | null;
}

export function useSync(userId: string | undefined) {
  const [state, setState] = useState<SyncState>({
    online: navigator.onLine,
    syncing: false,
    pending: 0,
    lastSync: localStorage.getItem("lastSync"),
    error: null,
  });
  const userIdRef = useRef(userId);
  userIdRef.current = userId;

  const refreshPending = useCallback(async () => {
    const count = await db.transactions.count();
    setState((s) => ({ ...s, pending: count }));
  }, []);

  const sync = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;
    if (!navigator.onLine) {
      setState((s) => ({ ...s, online: false, error: "Hors-ligne" }));
      return;
    }

    setState((s) => ({ ...s, syncing: true, error: null }));
    try {
      await syncFromCloud(uid);
      await pushLocalToCloud(uid);
      await deduplicateLocalDb();
      const now = new Date().toISOString();
      localStorage.setItem("lastSync", now);
      setState((s) => ({ ...s, syncing: false, lastSync: now, online: true, error: null }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erreur de sync";
      setState((s) => ({ ...s, syncing: false, error: msg }));
    }
  }, []);

  useEffect(() => {
    const onOnline = () => setState((s) => ({ ...s, online: true }));
    const onOffline = () => setState((s) => ({ ...s, online: false }));
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending]);

  // Keep-alive ping: prevents the Supabase database from pausing due to inactivity.
  // Runs every 4 minutes (under the typical 5-minute idle pause threshold).
  useEffect(() => {
    const PING_INTERVAL = 4 * 60 * 1000;
    const ping = async () => {
      if (!navigator.onLine) return;
      try {
        await supabase.from("profiles").select("id").limit(1).maybeSingle();
      } catch {
        // ignore — the ping is best-effort
      }
    };
    ping();
    const interval = setInterval(ping, PING_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return { state, sync, refreshPending, genClientUuid };
}

async function syncFromCloud(userId: string) {
  // Fetch user's espaces
  const { data: userEspaces, error: ueError } = await supabase
    .from("user_espaces")
    .select("user_id, espace_id, role_dans_espace")
    .eq("user_id", userId);

  if (ueError) throw new Error(ueError.message);
  if (!userEspaces) return;

  const espaceIds = userEspaces.map((ue) => ue.espace_id);
  if (espaceIds.length === 0) return;

  // Sync espaces
  const { data: espaces, error: espError } = await supabase
    .from("espaces")
    .select("id, nom, cree_le, cree_par")
    .in("id", espaceIds);

  if (espError) throw new Error(espError.message);
  if (espaces) {
    for (const e of espaces) {
      await db.espaces.put({ id: e.id, nom: e.nom, cree_le: e.cree_le });
    }
  }

  // Sync user_espaces
  for (const ue of userEspaces) {
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
    } else if (existing.id) {
      await db.user_espaces.update(existing.id, { role_dans_espace: ue.role_dans_espace as "operateur" | "admin" | "superviseur" });
    }
  }

  // Sync transactions for each espace
  const { data: transactions, error: txError } = await supabase
    .from("transactions")
    .select("id, client_uuid, date_transaction, motif, type_operation, montant, categorie, statut, auteur_id, cree_le, modifie_le, supprime, espace_id")
    .in("espace_id", espaceIds);

  if (txError) throw new Error(txError.message);
  if (transactions) {
    for (const tx of transactions) {
      const local = await db.transactions.where("client_uuid").equals(tx.client_uuid).first();
      if (!local) {
        await db.transactions.add({
          client_uuid: tx.client_uuid,
          date_transaction: tx.date_transaction,
          motif: tx.motif,
          type_operation: tx.type_operation as "miditra" | "mivoaka",
          montant: Number(tx.montant),
          categorie: tx.categorie,
          statut: tx.statut as "validee" | "en_attente_validation",
          auteur_id: tx.auteur_id,
          cree_le: tx.cree_le,
          modifie_le: tx.modifie_le ?? null,
          supprime: tx.supprime ?? false,
          espace_id: tx.espace_id,
        });
      } else if (local.id) {
        const cloudMod = tx.modifie_le ?? tx.cree_le;
        const localMod = local.modifie_le ?? local.cree_le;
        if (cloudMod > localMod) {
          await db.transactions.update(local.id, {
            date_transaction: tx.date_transaction,
            motif: tx.motif,
            type_operation: tx.type_operation as "miditra" | "mivoaka",
            montant: Number(tx.montant),
            categorie: tx.categorie,
            statut: tx.statut as "validee" | "en_attente_validation",
            modifie_le: tx.modifie_le ?? null,
            supprime: tx.supprime ?? false,
          });
        }
      }
    }
  }

  // Sync budgets
  const { data: budgets, error: budError } = await supabase
    .from("budgets")
    .select("id, categorie, mois_annee, limite, espace_id, cree_par")
    .in("espace_id", espaceIds);

  if (budError) throw new Error(budError.message);
  if (budgets) {
    for (const b of budgets) {
      const existing = await db.budgets
        .where("espace_id").equals(b.espace_id)
        .and((row) => row.categorie === b.categorie && row.mois_annee === b.mois_annee)
        .first();
      if (!existing) {
        await db.budgets.add({
          categorie: b.categorie,
          mois_annee: b.mois_annee,
          limite: Number(b.limite),
          espace_id: b.espace_id,
        });
      } else if (existing.id) {
        await db.budgets.update(existing.id, { limite: Number(b.limite) });
      }
    }
  }

  // Sync alertes
  const { data: alertes, error: alertError } = await supabase
    .from("alertes")
    .select("id, type, seuil, active, espace_id, cree_par")
    .in("espace_id", espaceIds);

  if (alertError) throw new Error(alertError.message);
  if (alertes) {
    for (const a of alertes) {
      const existing = await db.alertes
        .where("espace_id").equals(a.espace_id)
        .and((row) => row.type === a.type)
        .first();
      if (!existing) {
        await db.alertes.add({
          type: a.type as "solde_bas" | "grosse_depense",
          seuil: Number(a.seuil),
          active: a.active,
          espace_id: a.espace_id,
        });
      } else if (existing.id) {
        await db.alertes.update(existing.id, { seuil: Number(a.seuil), active: a.active });
      }
    }
  }

  // Sync recurring transactions
  const { data: recurring, error: recError } = await supabase
    .from("transactions_recurrentes")
    .select("id, motif, type_operation, montant, categorie, frequence, date_debut, prochaine_occurrence, actif, auteur_id, espace_id, cree_le")
    .in("espace_id", espaceIds);

  if (recError) throw new Error(recError.message);
  if (recurring) {
    for (const r of recurring) {
      const existing = await db.recurring
        .where("espace_id").equals(r.espace_id)
        .and((row) => row.motif === r.motif && row.date_debut === r.date_debut)
        .first();
      if (!existing) {
        await db.recurring.add({
          motif: r.motif,
          type_operation: r.type_operation as "miditra" | "mivoaka",
          montant: Number(r.montant),
          categorie: r.categorie,
          frequence: r.frequence as "quotidien" | "hebdomadaire" | "mensuel" | "annuel",
          date_debut: r.date_debut,
          prochaine_occurrence: r.prochaine_occurrence,
          actif: r.actif,
          auteur_id: r.auteur_id,
          espace_id: r.espace_id,
          cree_le: r.cree_le,
        });
      } else if (existing.id) {
        await db.recurring.update(existing.id, {
          actif: r.actif,
          prochaine_occurrence: r.prochaine_occurrence,
          montant: Number(r.montant),
        });
      }
    }
  }

  // Sync scheduled transactions
  const { data: scheduled, error: schedError } = await supabase
    .from("transactions_planifiees")
    .select("id, titre, motif, type_operation, montant, categorie, date_prevue, statut, alerte_jours_avant, auteur_id, espace_id, cree_le")
    .in("espace_id", espaceIds);

  if (schedError) throw new Error(schedError.message);
  if (scheduled) {
    for (const s of scheduled) {
      const existing = await db.scheduled
        .where("espace_id").equals(s.espace_id)
        .and((row) => row.titre === s.titre && row.date_prevue === s.date_prevue)
        .first();
      if (!existing) {
        await db.scheduled.add({
          titre: s.titre,
          motif: s.motif,
          type_operation: s.type_operation as "miditra" | "mivoaka",
          montant: Number(s.montant),
          categorie: s.categorie,
          date_prevue: s.date_prevue,
          statut: s.statut as "en_attente" | "realisee" | "annulee",
          alerte_jours_avant: s.alerte_jours_avant,
          auteur_id: s.auteur_id,
          espace_id: s.espace_id,
          cree_le: s.cree_le,
        });
      } else if (existing.id) {
        await db.scheduled.update(existing.id, { statut: s.statut as "en_attente" | "realisee" | "annulee" });
      }
    }
  }

  // Sync settings
  const { data: settings, error: setError } = await supabase
    .from("settings")
    .select("cle, valeur, espace_id")
    .in("espace_id", espaceIds);

  if (setError) throw new Error(setError.message);
  if (settings) {
    for (const s of settings) {
      const existing = await db.settings
        .where("espace_id").equals(s.espace_id)
        .and((row) => row.cle === s.cle)
        .first();
      if (!existing) {
        await db.settings.add({ cle: s.cle, valeur: s.valeur, espace_id: s.espace_id });
      } else if (existing.id) {
        await db.settings.update(existing.id, { valeur: s.valeur });
      }
    }
  }

  // Sync profiles (users) for the espaces
  const allUserIds = [...new Set(userEspaces.map((ue) => ue.user_id))];
  const { data: profiles, error: profError } = await supabase
    .from("profiles")
    .select("id, nom, email, role, langue, actif, cree_le")
    .in("id", allUserIds);

  if (profError) throw new Error(profError.message);
  if (profiles) {
    for (const p of profiles) {
      await db.users.put({
        id: p.id,
        nom: p.nom,
        email: p.email,
        password: "",
        role: p.role as "operateur" | "admin" | "superviseur",
        langue: p.langue as "fr" | "mg",
        actif: p.actif,
        cree_le: p.cree_le,
      });
    }
  }

  // Sync categories
  const { data: categories, error: catError } = await supabase
    .from("categories")
    .select("id, nom, couleur, icone, ordre, active, user_id")
    .or(`user_id.is.null,user_id.eq.${userId}`);

  if (catError) throw new Error(catError.message);
  if (categories && categories.length > 0) {
    const localCats = await db.categories.toArray();
    for (const c of categories) {
      const existing = localCats.find((lc) => lc.nom === c.nom);
      if (!existing) {
        await db.categories.add({
          nom: c.nom,
          couleur: c.couleur,
          icone: c.icone,
          ordre: c.ordre,
          active: c.active,
        });
      } else if (existing.id) {
        await db.categories.update(existing.id, {
          couleur: c.couleur,
          icone: c.icone,
          ordre: c.ordre,
          active: c.active,
        });
      }
    }
  }
}

async function pushLocalToCloud(userId: string) {
  // Push transactions that don't exist in cloud yet
  const localTxs = await db.transactions.toArray();
  if (localTxs.length === 0) return;

  // Fetch existing client_uuids from cloud to avoid duplicates
  const userEspaces = await db.user_espaces.where("user_id").equals(userId).toArray();
  const espaceIds = userEspaces.map((ue) => ue.espace_id);
  if (espaceIds.length === 0) return;

  const { data: cloudTxUuids } = await supabase
    .from("transactions")
    .select("client_uuid")
    .in("espace_id", espaceIds);

  const cloudUuids = new Set(cloudTxUuids?.map((t) => t.client_uuid) ?? []);

  const toInsert = localTxs
    .filter((tx) => !cloudUuids.has(tx.client_uuid) && tx.espace_id && espaceIds.includes(tx.espace_id))
    .map((tx) => ({
      client_uuid: tx.client_uuid,
      date_transaction: tx.date_transaction,
      motif: tx.motif,
      type_operation: tx.type_operation,
      montant: tx.montant,
      categorie: tx.categorie,
      statut: tx.statut,
      auteur_id: tx.auteur_id,
      cree_le: tx.cree_le,
      modifie_le: tx.modifie_le ?? null,
      supprime: tx.supprime,
      espace_id: tx.espace_id!,
    }));

  if (toInsert.length > 0) {
    const { error } = await supabase.from("transactions").insert(toInsert);
    if (error) throw new Error(error.message);
  }

  // Push modified transactions (local modifie_le > cloud)
  const modified = localTxs.filter((tx) => tx.modifie_le && cloudUuids.has(tx.client_uuid));
  for (const tx of modified) {
    const { error } = await supabase
      .from("transactions")
      .update({
        date_transaction: tx.date_transaction,
        motif: tx.motif,
        type_operation: tx.type_operation,
        montant: tx.montant,
        categorie: tx.categorie,
        modifie_le: tx.modifie_le,
        supprime: tx.supprime,
      })
      .eq("client_uuid", tx.client_uuid);
    if (error) throw new Error(error.message);
  }

  // Push budgets
  const localBudgets = await db.budgets.toArray();
  for (const b of localBudgets) {
    if (!b.espace_id || !espaceIds.includes(b.espace_id)) continue;
    const { data: existing } = await supabase
      .from("budgets")
      .select("id")
      .eq("espace_id", b.espace_id)
      .eq("categorie", b.categorie)
      .eq("mois_annee", b.mois_annee)
      .maybeSingle();
    if (!existing) {
      await supabase.from("budgets").insert({
        categorie: b.categorie,
        mois_annee: b.mois_annee,
        limite: b.limite,
        espace_id: b.espace_id,
        cree_par: userId,
      });
    } else {
      await supabase.from("budgets").update({ limite: b.limite }).eq("id", existing.id);
    }
  }

  // Push alertes
  const localAlertes = await db.alertes.toArray();
  for (const a of localAlertes) {
    if (!a.espace_id || !espaceIds.includes(a.espace_id)) continue;
    const { data: existing } = await supabase
      .from("alertes")
      .select("id")
      .eq("espace_id", a.espace_id)
      .eq("type", a.type)
      .maybeSingle();
    if (!existing) {
      await supabase.from("alertes").insert({
        type: a.type,
        seuil: a.seuil,
        active: a.active,
        espace_id: a.espace_id,
        cree_par: userId,
      });
    } else {
      await supabase.from("alertes").update({ seuil: a.seuil, active: a.active }).eq("id", existing.id);
    }
  }

  // Push settings
  const localSettings = await db.settings.toArray();
  for (const s of localSettings) {
    if (!s.espace_id || !espaceIds.includes(s.espace_id)) continue;
    const { data: existing } = await supabase
      .from("settings")
      .select("cle, valeur")
      .eq("espace_id", s.espace_id)
      .eq("cle", s.cle)
      .maybeSingle();
    if (!existing) {
      await supabase.from("settings").insert({ cle: s.cle, valeur: s.valeur, espace_id: s.espace_id });
    } else if (existing.valeur !== s.valeur) {
      await supabase.from("settings").update({ valeur: s.valeur }).eq("cle", s.cle).eq("espace_id", s.espace_id);
    }
  }

  // Push recurring transactions
  const localRecurring = await db.recurring.toArray();
  for (const r of localRecurring) {
    if (!r.espace_id || !espaceIds.includes(r.espace_id)) continue;
    const { data: existing } = await supabase
      .from("transactions_recurrentes")
      .select("id")
      .eq("espace_id", r.espace_id)
      .eq("motif", r.motif)
      .eq("date_debut", r.date_debut)
      .maybeSingle();
    if (!existing) {
      await supabase.from("transactions_recurrentes").insert({
        motif: r.motif,
        type_operation: r.type_operation,
        montant: r.montant,
        categorie: r.categorie,
        frequence: r.frequence,
        date_debut: r.date_debut,
        prochaine_occurrence: r.prochaine_occurrence,
        actif: r.actif,
        auteur_id: r.auteur_id,
        espace_id: r.espace_id,
        cree_le: r.cree_le,
      });
    } else {
      await supabase.from("transactions_recurrentes").update({
        actif: r.actif,
        prochaine_occurrence: r.prochaine_occurrence,
        montant: r.montant,
      }).eq("id", existing.id);
    }
  }

  // Push scheduled transactions
  const localScheduled = await db.scheduled.toArray();
  for (const s of localScheduled) {
    if (!s.espace_id || !espaceIds.includes(s.espace_id)) continue;
    const { data: existing } = await supabase
      .from("transactions_planifiees")
      .select("id")
      .eq("espace_id", s.espace_id)
      .eq("titre", s.titre)
      .eq("date_prevue", s.date_prevue)
      .maybeSingle();
    if (!existing) {
      await supabase.from("transactions_planifiees").insert({
        titre: s.titre,
        motif: s.motif,
        type_operation: s.type_operation,
        montant: s.montant,
        categorie: s.categorie,
        date_prevue: s.date_prevue,
        statut: s.statut,
        alerte_jours_avant: s.alerte_jours_avant,
        auteur_id: s.auteur_id,
        espace_id: s.espace_id,
        cree_le: s.cree_le,
      });
    } else {
      await supabase.from("transactions_planifiees").update({
        statut: s.statut,
        montant: s.montant,
      }).eq("id", existing.id);
    }
  }

  // Push categories
  const localCats = await db.categories.toArray();
  const { data: cloudCats } = await supabase.from("categories").select("id, nom");
  const cloudCatMap = new Map(cloudCats?.map((c) => [c.nom, c.id]) ?? []);
  for (const c of localCats) {
    const existingId = cloudCatMap.get(c.nom);
    if (!existingId) {
      await supabase.from("categories").insert({
        id: c.id,
        nom: c.nom,
        couleur: c.couleur,
        icone: c.icone,
        ordre: c.ordre,
        active: c.active,
      });
    } else {
      await supabase.from("categories").update({
        couleur: c.couleur,
        icone: c.icone,
        ordre: c.ordre,
        active: c.active,
      }).eq("id", existingId);
    }
  }

  // Push profiles (nom, langue, role updates)
  const localUsers = await db.users.toArray();
  for (const u of localUsers) {
    const { data: existing } = await supabase.from("profiles").select("id").eq("id", u.id).maybeSingle();
    if (existing) {
      await supabase.from("profiles").update({
        nom: u.nom,
        langue: u.langue,
        role: u.role,
        actif: u.actif,
      }).eq("id", u.id);
    }
  }
}
