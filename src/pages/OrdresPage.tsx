import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ClipboardCheck,
  Plus,
  X,
  Check,
  Ban,
  RotateCcw,
  ArrowDownCircle,
  ArrowUpCircle,
  Bell,
  BellOff,
  CalendarClock,
  CheckCircle2,
  AlertTriangle,
  Info,
  UserCheck,
  History,
  Inbox,
} from "lucide-react";
import { Layout } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useEspace } from "@/lib/espace";
import { useTransactions } from "@/lib/useTransactions";
import { useInbox, type Member } from "@/lib/inbox";
import { useToast } from "@/components/Toast";
import {
  canExecute,
  canManage,
  cancelOrder,
  createOrder,
  describeEvent,
  eventTone,
  executeOrder,
  refuseOrder,
  reopenOrder,
  type EventTone,
  type Order,
} from "@/lib/ordres";
import {
  disableSystemNotifications,
  enableSystemNotifications,
  systemNotificationsEnabled,
  systemNotificationsSupported,
} from "@/lib/notify";
import { t, categoryLabel, type Lang } from "@/lib/i18n";
import { daysUntil, formatAriary, formatDate, formatDateTime, todayISO } from "@/lib/format";
import type { LocalTransaction } from "@/lib/db";

type Tab = "todo" | "ordres" | "activite";
type OrderFilter = "en_attente" | "realisee" | "refusee" | "annulee" | "all";

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="card relative z-10 max-h-[92vh] w-full max-w-md animate-fade-up overflow-y-auto rounded-b-none !bg-[#101827] p-6 shadow-2xl sm:rounded-b-2xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/10 hover:text-white" aria-label="Fermer">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function memberLabel(m: Member | undefined, lang: Lang) {
  if (!m) return "—";
  return m.fonction ? `${m.nom} — ${m.fonction}` : `${m.nom} (${t(lang, m.role === "operateur" ? "operator" : m.role)})`;
}

function TypeIcon({ type }: { type: "miditra" | "mivoaka" }) {
  return type === "miditra" ? (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400"><ArrowDownCircle size={20} /></div>
  ) : (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400"><ArrowUpCircle size={20} /></div>
  );
}

function StatusBadge({ statut, lang }: { statut: Order["statut"]; lang: Lang }) {
  const cls =
    statut === "en_attente" ? "badge-pending" : statut === "realisee" ? "badge-synced" : "badge-expense";
  return <span className={`${cls} !text-[10px]`}>{t(lang, `orderStatus_${statut}`)}</span>;
}

function DueLabel({ date, lang }: { date: string; lang: Lang }) {
  const d = daysUntil(date);
  const cls = d < 0 ? "text-rose-400" : d <= 1 ? "text-amber-300" : "text-slate-400";
  const txt = d < 0 ? t(lang, "overdue") : d === 0 ? t(lang, "todayLabel") : t(lang, "inDays", { n: d });
  return (
    <span className={cls}>
      {formatDate(date, lang)} · {txt}
    </span>
  );
}

const toneStyle: Record<EventTone, { icon: typeof Info; cls: string }> = {
  action: { icon: Bell, cls: "bg-amber-500/15 text-amber-300" },
  ok: { icon: CheckCircle2, cls: "bg-emerald-500/15 text-emerald-300" },
  warn: { icon: AlertTriangle, cls: "bg-rose-500/15 text-rose-300" },
  info: { icon: Info, cls: "bg-sky-500/15 text-sky-300" },
};

export function OrdresPage() {
  const { profile, lang, mode } = useAuth();
  const { currentEspace, role } = useEspace();
  const { categories, validationThreshold, validateTransaction, refuseTransaction } = useTransactions();
  const inbox = useInbox();
  const { show: toast } = useToast();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "todo";
  const setTab = (next: Tab) => setParams(next === "todo" ? {} : { tab: next }, { replace: true });
  const [filter, setFilter] = useState<OrderFilter>("en_attente");
  const [busy, setBusy] = useState(false);
  const me = profile?.id ?? "";
  const isAdmin = role === "admin";

  // Modales
  const [creating, setCreating] = useState(false);
  const [executing, setExecuting] = useState<Order | null>(null);
  const [execDate, setExecDate] = useState(todayISO());
  const [reasonFor, setReasonFor] = useState<
    { kind: "refuseOrder"; order: Order } | { kind: "cancelOrder"; order: Order } | { kind: "refuseTx"; tx: LocalTransaction } | null
  >(null);
  const [reason, setReason] = useState("");
  const [sysNotif, setSysNotif] = useState(systemNotificationsEnabled());

  const memberById = useMemo(() => new Map(inbox.members.map((m) => [m.id, m])), [inbox.members]);
  const nameOf = (id: string | null | undefined) => (id ? inbox.names.get(id) ?? "—" : "—");
  const withFonction = (id: string | null | undefined) => {
    if (!id) return "—";
    const m = memberById.get(id);
    return m?.fonction ? `${m.nom} (${m.fonction})` : nameOf(id);
  };

  // Ouvrir l'onglet Activité marque tout comme lu.
  const { markAllRead, unread } = inbox;
  useEffect(() => {
    if (tab === "activite" && unread > 0) {
      const timer = setTimeout(markAllRead, 1500);
      return () => clearTimeout(timer);
    }
  }, [tab, unread, markAllRead]);

  const run = async (fn: () => Promise<void>, okMsg: string) => {
    setBusy(true);
    try {
      await fn();
      toast(okMsg, "success");
      return true;
    } catch (err) {
      toast(err instanceof Error ? err.message : t(lang, "error"), "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const doExecute = async () => {
    if (!executing) return;
    const ok = await run(() => executeOrder(executing, me, role, validationThreshold, execDate), t(lang, "orderExecuted"));
    if (ok) setExecuting(null);
  };

  const submitReason = async (e: FormEvent) => {
    e.preventDefault();
    if (!reasonFor) return;
    const r = reason.trim();
    if (reasonFor.kind !== "cancelOrder" && !r) {
      toast(t(lang, "reasonRequired"), "error");
      return;
    }
    let ok = false;
    if (reasonFor.kind === "refuseOrder") ok = await run(() => refuseOrder(reasonFor.order, me, r), t(lang, "orderRefused"));
    else if (reasonFor.kind === "cancelOrder") ok = await run(() => cancelOrder(reasonFor.order, me, r), t(lang, "orderCancelled"));
    else ok = await run(() => refuseTransaction(reasonFor.tx.client_uuid, r), t(lang, "txRefused"));
    if (ok) {
      setReasonFor(null);
      setReason("");
    }
  };

  const toggleSysNotif = async () => {
    if (sysNotif) {
      disableSystemNotifications();
      setSysNotif(false);
      return;
    }
    const ok = await enableSystemNotifications();
    setSysNotif(ok);
    toast(ok ? t(lang, "sysNotifOn") : t(lang, "sysNotifDenied"), ok ? "success" : "error");
  };

  const filteredOrders = inbox.orders.filter((o) => filter === "all" || o.statut === filter);

  // ------------------------------------------------------------------ rendu
  const OrderCard = ({ o, compact = false }: { o: Order; compact?: boolean }) => {
    const exec = canExecute(o, me, role);
    const manage = canManage(o, me, role);
    return (
      <article className={`card p-4 ${exec && !compact ? "border-amber-500/30" : ""}`}>
        <div className="flex items-start gap-3">
          <TypeIcon type={o.type_operation} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-bold text-white">{o.titre}</h3>
              <StatusBadge statut={o.statut} lang={lang} />
            </div>
            <div className={`mt-0.5 text-lg font-extrabold ${o.type_operation === "miditra" ? "text-emerald-400" : "text-rose-400"}`}>
              {o.type_operation === "miditra" ? "+" : "−"}
              {formatAriary(o.montant, lang)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-400">
              <CalendarClock size={12} />
              {o.statut === "en_attente" ? <DueLabel date={o.date_prevue} lang={lang} /> : <span>{formatDate(o.date_prevue, lang)}</span>}
              <span>· {categoryLabel(lang, o.categorie)}</span>
            </div>
            {o.motif && <p className="mt-1.5 text-xs text-slate-300">{o.motif}</p>}

            {/* Traçabilité */}
            <ul className="mt-2 space-y-0.5 border-t border-white/10 pt-2 text-[11px] text-slate-500">
              <li>
                {t(lang, "traceIssuedBy", { who: withFonction(o.auteur_id), when: formatDateTime(o.cree_le, lang) })}
              </li>
              <li>{t(lang, "traceAssignedTo", { who: o.assigne_a ? withFonction(o.assigne_a) : t(lang, "anyTreasurer") })}</li>
              {o.statut === "realisee" && (
                <li className="text-emerald-400/80">
                  {t(lang, "traceExecutedBy", { who: withFonction(o.realisee_par), when: o.realisee_le ? formatDateTime(o.realisee_le, lang) : "" })}
                </li>
              )}
              {(o.statut === "refusee" || o.statut === "annulee") && (
                <li className="text-rose-400/80">
                  {t(lang, o.statut === "refusee" ? "traceRefusedBy" : "traceCancelledBy", {
                    who: withFonction(o.annulee_par),
                    when: o.annulee_le ? formatDateTime(o.annulee_le, lang) : "",
                  })}
                  {o.motif_annulation ? ` — « ${o.motif_annulation} »` : ""}
                </li>
              )}
            </ul>
          </div>
        </div>

        {(exec || (manage && o.statut !== "realisee")) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {exec && (
              <button
                onClick={() => {
                  setExecDate(todayISO());
                  setExecuting(o);
                }}
                disabled={busy}
                className="btn-primary flex-1 !py-2 !text-sm"
              >
                <Check size={15} />
                {t(lang, o.type_operation === "mivoaka" ? "executeDebit" : "executeCredit")}
              </button>
            )}
            {exec && o.auteur_id !== me && (
              <button onClick={() => { setReason(""); setReasonFor({ kind: "refuseOrder", order: o }); }} disabled={busy} className="btn-secondary !py-2 !text-sm">
                <Ban size={15} />
                {t(lang, "refuse")}
              </button>
            )}
            {manage && o.statut === "en_attente" && (
              <button onClick={() => { setReason(""); setReasonFor({ kind: "cancelOrder", order: o }); }} disabled={busy} className="btn-ghost !py-2 !text-sm">
                <X size={15} />
                {t(lang, "cancelOrder")}
              </button>
            )}
            {manage && (o.statut === "refusee" || o.statut === "annulee") && (
              <button onClick={() => run(() => reopenOrder(o, me), t(lang, "orderReopened"))} disabled={busy} className="btn-secondary !py-2 !text-sm">
                <RotateCcw size={15} />
                {t(lang, "reopenOrder")}
              </button>
            )}
          </div>
        )}
      </article>
    );
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "todo", label: t(lang, "tabTodo"), count: inbox.taskCount },
    { id: "ordres", label: t(lang, "tabOrders") },
    { id: "activite", label: t(lang, "tabActivity"), count: inbox.unread },
  ];

  return (
    <Layout
      title={t(lang, "ordersTitle")}
      subtitle={currentEspace?.nom}
      actions={
        isAdmin ? (
          <button onClick={() => setCreating(true)} className="btn-primary">
            <Plus size={16} />
            <span className="hidden sm:inline">{t(lang, "newOrder")}</span>
          </button>
        ) : undefined
      }
    >
      <div role="tablist" aria-label={t(lang, "ordersTitle")} className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-1">
        {tabs.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => setTab(x.id)}
            className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition ${tab === x.id ? "bg-emerald-500/20 text-emerald-300" : "text-slate-400 hover:text-white"}`}
          >
            {x.label}
            {!!x.count && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-slate-900">{x.count}</span>}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ À FAIRE */}
      {tab === "todo" && (
        <div className="space-y-8">
          <section aria-labelledby="todo-orders">
            <h2 id="todo-orders" className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
              <UserCheck size={16} className="text-amber-400" />
              {t(lang, "ordersToExecute")} ({inbox.toExecute.length})
            </h2>
            {inbox.toExecute.length === 0 ? (
              <p className="card p-5 text-sm text-slate-500">{t(lang, "noOrdersToExecute")}</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {inbox.toExecute.map((o) => <OrderCard key={o.id} o={o} />)}
              </div>
            )}
          </section>

          {isAdmin && (
            <section aria-labelledby="todo-validate">
              <h2 id="todo-validate" className="mb-3 flex items-center gap-2 text-sm font-bold text-white">
                <ClipboardCheck size={16} className="text-sky-400" />
                {t(lang, "toValidate")} ({inbox.toValidate.length})
              </h2>
              {inbox.toValidate.length === 0 ? (
                <p className="card p-5 text-sm text-slate-500">{t(lang, "nothingToValidate")}</p>
              ) : (
                <div className="space-y-2">
                  {inbox.toValidate.map((x) => (
                    <div key={x.client_uuid} className="card flex flex-wrap items-center gap-3 p-4 sm:flex-nowrap">
                      <TypeIcon type={x.type_operation} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{x.motif}</div>
                        <div className="text-xs text-slate-400">
                          {formatDate(x.date_transaction, lang)} · {categoryLabel(lang, x.categorie)} · {t(lang, "enteredBy", { who: withFonction(x.auteur_id) })}
                        </div>
                      </div>
                      <div className={`text-base font-bold ${x.type_operation === "miditra" ? "text-emerald-400" : "text-rose-400"}`}>
                        {x.type_operation === "miditra" ? "+" : "−"}
                        {formatAriary(x.montant, lang)}
                      </div>
                      <div className="flex w-full gap-2 sm:w-auto">
                        <button onClick={() => run(() => validateTransaction(x.client_uuid), t(lang, "txValidated"))} disabled={busy} className="btn-primary flex-1 !py-2 !text-sm">
                          <Check size={15} />
                          {t(lang, "validate")}
                        </button>
                        <button onClick={() => { setReason(""); setReasonFor({ kind: "refuseTx", tx: x }); }} disabled={busy} className="btn-secondary flex-1 !py-2 !text-sm">
                          <Ban size={15} />
                          {t(lang, "refuse")}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {mode === "cloud" && systemNotificationsSupported() && (
            <section className="card flex flex-wrap items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-300">
                {sysNotif ? <Bell size={18} /> : <BellOff size={18} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-white">{t(lang, "sysNotifTitle")}</div>
                <div className="text-xs text-slate-400">{t(lang, "sysNotifHint")}</div>
              </div>
              <button onClick={toggleSysNotif} className={sysNotif ? "btn-secondary" : "btn-primary"} aria-pressed={sysNotif}>
                {sysNotif ? t(lang, "disable") : t(lang, "enable")}
              </button>
            </section>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ ORDRES */}
      {tab === "ordres" && (
        <div>
          <div className="mb-4 flex flex-wrap gap-1.5">
            {(["en_attente", "realisee", "refusee", "annulee", "all"] as OrderFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                aria-pressed={filter === f}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${filter === f ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 text-slate-400 hover:text-white"}`}
              >
                {f === "all" ? t(lang, "all") : t(lang, `orderStatus_${f}`)} ({f === "all" ? inbox.orders.length : inbox.orders.filter((o) => o.statut === f).length})
              </button>
            ))}
          </div>
          {filteredOrders.length === 0 ? (
            <div className="card flex flex-col items-center gap-3 py-14 text-center text-slate-500">
              <Inbox size={32} className="opacity-40" />
              <p className="text-sm">{t(lang, "noOrders")}</p>
              {isAdmin && <p className="max-w-sm text-xs">{t(lang, "noOrdersHint")}</p>}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {filteredOrders.map((o) => <OrderCard key={o.id} o={o} compact />)}
            </div>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------- ACTIVITÉ */}
      {tab === "activite" && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-xs text-slate-500">
              <History size={14} />
              {t(lang, "activityHint")}
            </p>
            {inbox.unread > 0 && (
              <button onClick={inbox.markAllRead} className="btn-ghost !px-2 !py-1 !text-xs">{t(lang, "markAllRead")}</button>
            )}
          </div>
          {inbox.events.length === 0 ? (
            <div className="card py-14 text-center text-sm text-slate-500">{t(lang, "noActivity")}</div>
          ) : (
            <ol className="card divide-y divide-white/5">
              {inbox.events.map((ev) => {
                const tone = toneStyle[eventTone(ev.type)];
                const Icon = tone.icon;
                const isNew = ev.cree_le > inbox.lastSeen && ev.acteur_id !== me;
                return (
                  <li key={ev.id} className={`flex items-start gap-3 px-4 py-3 ${isNew ? "bg-amber-500/[0.06]" : ""}`}>
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.cls}`}><Icon size={15} /></div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-slate-200">{describeEvent(ev, lang, inbox.names, me)}</p>
                      <time dateTime={ev.cree_le} className="text-[11px] text-slate-500">{formatDateTime(ev.cree_le, lang)}</time>
                    </div>
                    {isNew && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-400" aria-label={t(lang, "unread")} />}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------ MODALES */}
      {creating && currentEspace && profile && (
        <CreateOrderModal
          lang={lang}
          members={inbox.members}
          categories={categories.map((c) => c.nom)}
          onClose={() => setCreating(false)}
          onCreate={async (input) => {
            const ok = await run(() => createOrder(currentEspace.id, profile.id, input).then(() => undefined), t(lang, "orderCreated"));
            if (ok) {
              setCreating(false);
              setTab("ordres");
              setFilter("en_attente");
            }
          }}
        />
      )}

      {executing && (
        <Modal title={t(lang, "confirmExecuteTitle")} onClose={() => setExecuting(null)}>
          <div className="space-y-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-center">
              <div className="text-sm text-slate-300">{executing.titre}</div>
              <div className={`mt-1 text-2xl font-extrabold ${executing.type_operation === "miditra" ? "text-emerald-400" : "text-rose-400"}`}>
                {executing.type_operation === "miditra" ? "+" : "−"}
                {formatAriary(executing.montant, lang)}
              </div>
              <div className="mt-1 text-xs text-slate-500">{t(lang, "amountFixedBy", { who: withFonction(executing.auteur_id) })}</div>
            </div>
            <div>
              <label htmlFor="exec-date" className="input-label">{t(lang, "executionDate")}</label>
              <input id="exec-date" type="date" value={execDate} max={todayISO()} onChange={(e) => setExecDate(e.target.value)} className="input" />
            </div>
            <p className="text-xs text-slate-400">{t(lang, "executeHint")}</p>
            <div className="flex gap-2">
              <button onClick={() => setExecuting(null)} className="btn-secondary flex-1">{t(lang, "cancel")}</button>
              <button onClick={doExecute} disabled={busy || !execDate} className="btn-primary flex-1">
                <Check size={16} />
                {t(lang, "confirm")}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {reasonFor && (
        <Modal
          title={t(lang, reasonFor.kind === "refuseOrder" ? "refuseOrderTitle" : reasonFor.kind === "cancelOrder" ? "cancelOrderTitle" : "refuseTxTitle")}
          onClose={() => setReasonFor(null)}
        >
          <form onSubmit={submitReason} className="space-y-4">
            <p className="text-sm text-slate-300">
              {reasonFor.kind === "refuseTx" ? `${reasonFor.tx.motif} — ${formatAriary(reasonFor.tx.montant, lang)}` : `${reasonFor.order.titre} — ${formatAriary(reasonFor.order.montant, lang)}`}
            </p>
            <div>
              <label htmlFor="reason" className="input-label">
                {t(lang, "reason")} {reasonFor.kind !== "cancelOrder" && <span className="text-rose-400">*</span>}
              </label>
              <textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="input min-h-[90px]"
                maxLength={500}
                required={reasonFor.kind !== "cancelOrder"}
                autoFocus
                placeholder={t(lang, "reasonPlaceholder")}
              />
              <p className="mt-1 text-xs text-slate-500">{t(lang, "reasonVisible")}</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setReasonFor(null)} className="btn-secondary flex-1">{t(lang, "cancel")}</button>
              <button type="submit" disabled={busy} className="btn-primary flex-1">{t(lang, "confirm")}</button>
            </div>
          </form>
        </Modal>
      )}
    </Layout>
  );
}

function CreateOrderModal({
  lang,
  members,
  categories,
  onClose,
  onCreate,
}: {
  lang: Lang;
  members: Member[];
  categories: string[];
  onClose: () => void;
  onCreate: (input: import("@/lib/ordres").OrderInput) => Promise<void>;
}) {
  // Par défaut : le premier membre dont la fonction ressemble à « trésorier ».
  const defaultAssignee = members.find((m) => /tr[ée]sor/i.test(m.fonction ?? ""))?.id ?? "";
  const [type, setType] = useState<"miditra" | "mivoaka">("mivoaka");
  const [titre, setTitre] = useState("");
  const [montant, setMontant] = useState("");
  const [date, setDate] = useState(todayISO());
  const [assignee, setAssignee] = useState(defaultAssignee);
  const [categorie, setCategorie] = useState(categories[0] ?? "autre");
  const [motif, setMotif] = useState("");
  const [rappel, setRappel] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amount = Number(montant.replace(/\s/g, "").replace(",", "."));
    if (!titre.trim() || !Number.isFinite(amount) || amount <= 0 || !date) {
      setError(t(lang, "fillAllFields"));
      return;
    }
    setSaving(true);
    await onCreate({
      titre,
      motif,
      categorie,
      type_operation: type,
      montant: Math.round(amount * 100) / 100,
      date_prevue: date,
      alerte_jours_avant: Math.max(0, Math.min(30, parseInt(rappel) || 0)),
      assigne_a: assignee || null,
    });
    setSaving(false);
  };

  return (
    <Modal title={t(lang, "newOrder")} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <p className="text-xs text-slate-400">{t(lang, "newOrderHint")}</p>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={t(lang, "type")}>
          <button type="button" role="radio" aria-checked={type === "mivoaka"} onClick={() => setType("mivoaka")} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${type === "mivoaka" ? "border-rose-500/60 bg-rose-500/15 text-rose-300" : "border-white/10 bg-white/5 text-slate-400"}`}>
            {t(lang, "debitOrder")}
          </button>
          <button type="button" role="radio" aria-checked={type === "miditra"} onClick={() => setType("miditra")} className={`rounded-xl border px-3 py-2.5 text-sm font-semibold transition ${type === "miditra" ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300" : "border-white/10 bg-white/5 text-slate-400"}`}>
            {t(lang, "creditOrder")}
          </button>
        </div>
        <div>
          <label htmlFor="o-titre" className="input-label">{t(lang, "orderTitle")}</label>
          <input id="o-titre" value={titre} onChange={(e) => setTitre(e.target.value)} className="input" maxLength={255} placeholder={t(lang, "orderTitlePlaceholder")} required autoFocus />
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <div>
            <label htmlFor="o-montant" className="input-label">{t(lang, "amount")} (Ar)</label>
            <input id="o-montant" inputMode="decimal" value={montant} onChange={(e) => setMontant(e.target.value)} className="input" placeholder="0" required />
          </div>
          <div>
            <label htmlFor="o-date" className="input-label">{t(lang, "scheduledDate")}</label>
            <input id="o-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="input" required />
          </div>
        </div>
        <div>
          <label htmlFor="o-assignee" className="input-label">{t(lang, "executor")}</label>
          <select id="o-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className="input">
            <option value="">{t(lang, "anyTreasurer")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{memberLabel(m, lang)}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-500">{t(lang, "executorHint")}</p>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <div>
            <label htmlFor="o-cat" className="input-label">{t(lang, "category")}</label>
            <select id="o-cat" value={categorie} onChange={(e) => setCategorie(e.target.value)} className="input">
              {categories.map((c) => <option key={c} value={c}>{categoryLabel(lang, c)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="o-rappel" className="input-label">{t(lang, "alertDays")}</label>
            <input id="o-rappel" type="number" min="0" max="30" value={rappel} onChange={(e) => setRappel(e.target.value)} className="input" />
          </div>
        </div>
        <div>
          <label htmlFor="o-motif" className="input-label">{t(lang, "orderMotif")}</label>
          <input id="o-motif" value={motif} onChange={(e) => setMotif(e.target.value)} className="input" maxLength={255} placeholder={t(lang, "motif")} />
        </div>
        {error && <div role="alert" className="text-sm text-rose-400">{error}</div>}
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">{t(lang, "cancel")}</button>
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            <CheckCircle2 size={16} />
            {t(lang, "issueOrder")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
