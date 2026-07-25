import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { ApiError } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Self-service account deletion — closes a real gap: until this existed,
 * the only way to remove an account was asking whoever runs the database
 * to do it by hand. Gated behind re-entering the password (not just the
 * already-authenticated session) since this is irreversible, same as the
 * API-key regeneration confirm above it, but with a higher bar given what's
 * at stake.
 *
 * Deliberately does NOT call navigate() itself after a successful delete.
 * `deleteAccount()` clears the auth context's `user`, and `RequireAuth`
 * (app.tsx) already has its own effect that redirects to /login the moment
 * `user` goes null on a protected route — a real two-navigation race with
 * that effect (this component racing it to "/" instead) was caught testing
 * against the live deployment: locally the two navigations resolved fast
 * enough to look fine, but production's added round-trip latency exposed
 * genuinely nondeterministic behavior — one run landed on /login, another
 * bounced between /dashboard and /login before settling. Firing only one
 * navigation (RequireAuth's) removes the race entirely instead of papering
 * over the timing.
 */
export function DangerZone() {
  const { deleteAccount } = useAuth();
  const { showError, showSuccess } = useToast();

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  function closeDialog() {
    setConfirmOpen(false);
    setPassword("");
  }

  async function confirmDeleteAccount() {
    if (!password) return;
    setDeleting(true);
    try {
      await deleteAccount(password);
      setConfirmOpen(false);
      setPassword("");
      showSuccess("Your account has been deleted.");
    } catch (err) {
      showError(
        err instanceof ApiError && err.status === 401
          ? "Incorrect password."
          : "Couldn't delete the account. Try again.",
      );
    } finally {
      setDeleting(false);
    }
  }

  function onPasswordKeyDown(e: JSX.TargetedKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && password && !deleting) {
      e.preventDefault();
      confirmDeleteAccount();
    }
  }

  return (
    <div class="danger-zone">
      <p>
        Permanently deletes your account, every check, all ping history, and every alert channel.
        There's no undo and no grace period. This is not the same as deleting a single check.
      </p>
      <button type="button" class="btn-danger-outline" onClick={() => setConfirmOpen(true)}>
        Delete account
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete your account?"
        message="Every check, ping history, and alert channel you own will be permanently removed. Enter your password to confirm."
        confirmLabel={deleting ? "Deleting…" : "Delete account"}
        danger
        confirmDisabled={!password || deleting}
        onConfirm={confirmDeleteAccount}
        onCancel={closeDialog}
      >
        <label>
          Password
          <input
            type="password"
            autocomplete="current-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            onKeyDown={onPasswordKeyDown}
            autoFocus
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
