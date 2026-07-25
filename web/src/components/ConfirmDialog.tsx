import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  /** Confirm button is disabled while true — for dialogs that gate the
   * action behind extra input (e.g. re-entering a password) below. */
  confirmDisabled?: boolean;
  /** Extra content rendered between the message and the action buttons. */
  children?: ComponentChildren;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A real <dialog> element — native focus trapping, Escape-to-close, and
 * backdrop all come from the platform instead of being reimplemented. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  confirmDisabled,
  children,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class="confirm-dialog"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      onClick={(e) => {
        // Click on the backdrop (the <dialog> element itself, outside its
        // content box) dismisses it, matching native modal expectations.
        if (e.target === ref.current) onCancel();
      }}
    >
      <h3>{title}</h3>
      <p>{message}</p>
      {children}
      <div class="dialog-actions">
        <button type="button" class="btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          class={danger ? "btn-danger" : "btn-primary"}
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
