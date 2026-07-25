import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { AuthShell } from "../components/AuthShell";
import { Link } from "../router";
import { useToast } from "../context/toast";
import { api } from "../api";

export function ForgotPassword() {
  const { showError } = useToast();
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await api.forgotPassword(email);
      // Always the same confirmation regardless of what actually happened
      // server-side — the backend itself never reveals whether the email
      // is registered (see /api/auth/forgot-password), so the UI can't
      // either without undoing that.
      setSent(true);
    } catch {
      showError("Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <AuthShell eyebrow="Check your email" headline="A reset link is on its way, if that account exists.">
        <h1>Check your inbox</h1>
        <p>
          If an account exists for <strong>{email}</strong>, a password reset link is on its way.
          It expires in 1 hour and works once. Check spam if it doesn't show up in a minute or two.
        </p>
        <p class="auth-switch">
          <Link to="/login">Back to log in</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Forgot your password?" headline="It happens. Let's get you back in.">
      <h1>Reset your password</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            id="forgot-email"
            type="email"
            autocomplete="email"
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            required
          />
        </label>
        <button type="submit" class="btn-primary" disabled={submitting}>
          {submitting ? "Sending…" : "Send reset link"}
        </button>
      </form>
      <p class="auth-switch">
        <Link to="/login">Back to log in</Link>
      </p>
    </AuthShell>
  );
}
