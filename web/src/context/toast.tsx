import { createContext } from "preact";
import type { ComponentChildren } from "preact";
import { useContext, useState, useCallback, useRef } from "preact/hooks";

type ToastKind = "error" | "success";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastState {
  toasts: Toast[];
  showError: (message: string) => void;
  showSuccess: (message: string) => void;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastState | null>(null);

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [leavingIds, setLeavingIds] = useState<Set<number>>(new Set());
  const nextId = useRef(0);

  // Two-step removal so the exit animation actually gets to play: marking
  // a toast "leaving" swaps its CSS animation from slide-in to slide-out,
  // and only after that animation's duration has actually elapsed does it
  // leave the toasts array. Removing it immediately on dismiss() would cut
  // the exit animation off before the first frame ever painted.
  const dismiss = useCallback((id: number) => {
    setLeavingIds((s) => new Set(s).add(id));
    setTimeout(() => {
      setToasts((t) => t.filter((toast) => toast.id !== id));
      setLeavingIds((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }, 220);
  }, []);

  const show = useCallback(
    (kind: ToastKind, message: string) => {
      const id = nextId.current++;
      setToasts((t) => [...t, { id, kind, message }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const showError = useCallback((message: string) => show("error", message), [show]);
  const showSuccess = useCallback((message: string) => show("success", message), [show]);

  return (
    <ToastContext.Provider value={{ toasts, showError, showSuccess, dismiss }}>
      {children}
      <div class="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            class={`toast toast-${t.kind}${leavingIds.has(t.id) ? " is-leaving" : ""}`}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastState {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
