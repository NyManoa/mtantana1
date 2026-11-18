import { useCallback, useEffect, useState } from "react";
import { db, type LocalEvent, type LocalTransaction } from "./db";
import { useAuth } from "./auth";
import { useEspace } from "./espace";
import { useDataVersion } from "./sync";
import { canExecute, type Order } from "./ordres";
import { daysUntil } from "./format";

const seenKey = (uid: string, espaceId: string) => `mtantana_seen_${uid}_${espaceId}`;

export interface Member {
  id: string;
  nom: string;
  role: string;
  fonction: string | null;
}

/**
 * Tout ce qui attend l'utilisateur dans l'espace courant :
 * ordres à exécuter, saisies à valider (admin), fil d'activité et non-lus.
 */
export function useInbox() {
  const { profile } = useAuth();
  const { currentEspace, role } = useEspace();
  const version = useDataVersion();
  const [orders, setOrders] = useState<Order[]>([]);
  const [toExecute, setToExecute] = useState<Order[]>([]);
  const [toValidate, setToValidate] = useState<LocalTransaction[]>([]);
  const [events, setEvents] = useState<LocalEvent[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [members, setMembers] = useState<Member[]>([]);
  const [lastSeen, setLastSeen] = useState("");
  const [tick, setTick] = useState(0);
  const espaceId = currentEspace?.id;
  const me = profile?.id;

  const load = useCallback(async () => {
    if (!espaceId || !me) return;
    const [sched, txs, evs, users, memberships] = await Promise.all([
      db.scheduled.where("espace_id").equals(espaceId).toArray(),
      role === "admin" ? db.transactions.where("espace_id").equals(espaceId).toArray() : Promise.resolve([] as LocalTransaction[]),
      db.evenements.where("[espace_id+cree_le]").between([espaceId, ""], [espaceId, "￿"]).reverse().limit(300).toArray(),
      db.users.toArray(),
      db.user_espaces.where("espace_id").equals(espaceId).toArray(),
    ]);
    const nameMap = new Map(users.map((u) => [u.id, u.nom]));
    setNames(nameMap);
    setMembers(
      memberships
        .map((m) => ({ id: m.user_id, nom: nameMap.get(m.user_id) ?? "—", role: m.role_dans_espace, fonction: m.fonction ?? null }))
        .sort((a, b) => a.nom.localeCompare(b.nom)),
    );
    const visible = sched.filter((s) => !s.deleted).map((s) => ({ ...s, id: s.id! })) as Order[];
    setOrders(visible.sort((a, b) => a.date_prevue.localeCompare(b.date_prevue)));
    setToExecute(visible.filter((o) => canExecute(o, me, role)));
    setToValidate(
      txs.filter((x) => !x.supprime && x.statut === "en_attente_validation").sort((a, b) => a.date_transaction.localeCompare(b.date_transaction)),
    );
    setEvents(evs);
    setLastSeen(localStorage.getItem(seenKey(me, espaceId)) ?? "");
  }, [espaceId, me, role]);

  useEffect(() => {
    load().catch(() => undefined);
  }, [load, version, tick]);

  // Nouvel événement temps réel → recharge immédiate.
  useEffect(() => {
    const onEvent = () => setTick((x) => x + 1);
    window.addEventListener("mtantana:event", onEvent);
    window.addEventListener("mtantana:inbox-read", onEvent);
    return () => {
      window.removeEventListener("mtantana:event", onEvent);
      window.removeEventListener("mtantana:inbox-read", onEvent);
    };
  }, []);

  const unread = events.filter((e) => e.cree_le > lastSeen && e.acteur_id !== me).length;

  const markAllRead = useCallback(() => {
    if (!me || !espaceId) return;
    const latest = events[0]?.cree_le ?? new Date().toISOString();
    try {
      localStorage.setItem(seenKey(me, espaceId), latest > new Date().toISOString() ? latest : new Date().toISOString());
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("mtantana:inbox-read"));
  }, [me, espaceId, events]);

  const dueSoon = toExecute.filter((o) => daysUntil(o.date_prevue) <= Math.max(o.alerte_jours_avant, 0));

  return {
    orders,
    toExecute,
    toValidate,
    dueSoon,
    events,
    names,
    members,
    unread,
    lastSeen,
    taskCount: toExecute.length + toValidate.length,
    markAllRead,
    reload: load,
  };
}
