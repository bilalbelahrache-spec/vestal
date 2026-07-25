import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { AuthShell } from "../components/AuthShell";
import { Link, useRouter } from "../router";
import { useToast } from "../context/toast";
import { api, ApiError } from "../api";

const MIN_PASSWORD_LENGTH = 8;

/** Reads the token from the query string directly rather than through the
 * router — the hand-rolled router (router.tsx) matches on pathname only,
 * so "/reset-password?token=..." still renders this page; the token just
 * isn't part of routing state. */
function tokenFromLocation(): string {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

export function ResetPassword() {
  const { navigate } = useRouter();
  const { showError, showSuccess } = useToast();
  const [token] = useState(tokenFromLocation);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function validate(): string | null {
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirm) return "Passwords don't match.";
    return null;
  }

  async function onSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) {
      showError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      await api.resetPassword(token, password);
      showSuccess("Password updated. Log in with your new password.");
      navigate("/login", { replace: true });
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!token) {
    return (
      <AuthShell eyebrow="Reset password" headline="This link is missing something.">
        <h1>Invalid reset link</h1>
        <p>This link is missing its token. It may have been copied incorrectly.</p>
        <p class="auth-switch">
          <Link to="/forgot-password">Request a new link</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Almost there" headline="Pick a new password and you're back in.">
      <h1>Set a new password</h1>
      <form onSubmit={onSubmit}>
        <label>
          New password
          <input
            id="reset-password"
            type="password"
            autocomplete="new-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <label>
          Confirm new password
          <input
            id="reset-confirm-password"
            type="password"
            autocomplete="new-password"
            value={confirm}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            required
          />
        </label>
        <button type="submit" class="btn-primary" disabled={submitting}>
          {submitting ? "Updating…" : "Update password"}
        </button>
      </form>
      <p class="auth-switch">
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthShell>
  );
}
