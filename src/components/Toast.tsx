import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { CheckCircle2, X, AlertCircle, Undo2, Bell } from "lucide-react";

interface Toast {
  id: number;
  /** info = notification de l'espace (affichée plus longtemps) */
  type: "success" | "error" | "undo" | "info";
  message: string;
  onUndo?: () => void;
}

interface ToastContextValue {
  show: (message: string, type?: Toast["type"], onUndo?: () => void) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const show = useCallback(
    (message: string, type: Toast["type"] = "success", onUndo?: () => void) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t, { id, type, message, onUndo }]);
      setTimeout(() => dismiss(id), type === "undo" ? 30000 : type === "info" ? 9000 : 4000);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <div className="fixed bottom-5 left-4 right-4 z-[60] flex flex-col items-end gap-2 sm:left-auto sm:right-5" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            className={`card animate-fade-up flex w-full items-center gap-3 px-4 py-3 shadow-xl sm:w-auto ${toast.type === "info" ? "border-amber-500/40" : ""}`}
            style={{ maxWidth: 400 }}
          >
            {toast.type === "success" && <CheckCircle2 size={18} className="shrink-0 text-emerald-400" />}
            {toast.type === "error" && <AlertCircle size={18} className="shrink-0 text-rose-400" />}
            {toast.type === "undo" && <Undo2 size={18} className="shrink-0 text-sky-400" />}
            {toast.type === "info" && <Bell size={18} className="shrink-0 text-amber-400" />}
            <span className="flex-1 text-sm text-slate-200">{toast.message}</span>
            {toast.type === "undo" && toast.onUndo && (
              <button
                onClick={() => {
                  toast.onUndo?.();
                  dismiss(toast.id);
                }}
                className="rounded-lg bg-sky-500/20 px-2.5 py-1 text-xs font-semibold text-sky-300 transition hover:bg-sky-500/30"
              >
                Annuler
              </button>
            )}
            <button
              onClick={() => dismiss(toast.id)}
              className="rounded-lg p-1 text-slate-500 transition hover:bg-white/10 hover:text-white"
              aria-label="Fermer"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
