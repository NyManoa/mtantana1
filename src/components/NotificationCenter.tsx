import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useToast } from "@/components/Toast";
import { db, todayISO, type LocalEvent } from "@/lib/db";
import { describeEvent, canExecute } from "@/lib/ordres";
import { daysUntil, formatAriary, formatDate } from "@/lib/format";
import { t } from "@/lib/i18n";
import { showSystemNotification } from "@/lib/notify";

/**
 * Annonce les événements de l'espace reçus en temps réel (toast + notification
 * système si l'onglet est en arrière-plan) et rappelle les ordres à échéance.
 */
export function NotificationCenter() {
  const { profile, lang } = useAuth();
  const { espaces, currentEspace, role } = useEspace();
  const { show } = useToast();
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;
  const me = profile?.id;

  useEffect(() => {
    if (!me) return;
    const mine = new Set(espaces.map((e) => e.id));
    const onEvent = async (e: Event) => {
      const ev = (e as CustomEvent<LocalEvent>).detail;
      if (!ev || ev.acteur_id === me || !mine.has(ev.espace_id)) return;
      const users = await db.users.toArray();
      const text = describeEvent(ev, lang, new Map(users.map((u) => [u.id, u.nom])), me);
      const espaceName = espaces.find((x) => x.id === ev.espace_id)?.nom ?? "M'tantana";
      show(text, "info");
      showSystemNotification(`M'tantana — ${espaceName}`, text, ev.id, () => navRef.current("/ordres?tab=activite"));
    };
    window.addEventListener("mtantana:event", onEvent);
    return () => window.removeEventListener("mtantana:event", onEvent);
  }, [me, espaces, lang, show]);

  // Rappel (une fois par jour et par ordre) des ordres à exécuter bientôt.
  useEffect(() => {
    if (!me || !currentEspace) return;
    let cancelled = false;
    (async () => {
      const rows = await db.scheduled.where("espace_id").equals(currentEspace.id).toArray();
      const today = todayISO();
      for (const o of rows) {
        if (cancelled || o.deleted || !canExecute(o, me, role)) continue;
        const days = daysUntil(o.date_prevue);
        if (days > Math.max(o.alerte_jours_avant, 0)) continue;
        const key = `mtantana_due_${o.uuid}_${today}`;
        if (localStorage.getItem(key)) continue;
        try {
          localStorage.setItem(key, "1");
        } catch {
          /* ignore */
        }
        const when = days < 0 ? t(lang, "overdue") : days === 0 ? t(lang, "todayLabel").toLocaleLowerCase() : t(lang, "inDays", { n: days });
        const text = t(lang, "orderDueReminder", { title: o.titre, amount: formatAriary(o.montant, lang), when, date: formatDate(o.date_prevue, lang) });
        show(text, "info");
        showSystemNotification("M'tantana", text, `due-${o.uuid}`, () => navRef.current("/ordres"));
      }
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [me, currentEspace, role, lang, show]);

  return null;
}
