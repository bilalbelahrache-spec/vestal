import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { useRouter, Link } from "../router";
import { AuthShell } from "../components/AuthShell";
import { ApiError } from "../api";
import { usePageMeta } from "../lib/seo";

export function Login() {
  usePageMeta({ title: "Log in", description: "Log in to your Vestal account." });
  const { login, completeTotpLogin } = useAuth();
  const { showError } = useToast();
  const { navigate } = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [code, setCode] = useState("");

  async function onSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const result = await login(email, password);
      if (result.totpRequired) {
        setPendingToken(result.pendingToken);
      } else {
        navigate("/dashboard", { replace: true });
      }
    } catch (err) {
      // Deliberately generic even in the UI — the backend already avoids
      // distinguishing "no such account" from "wrong password" so this
      // endpoint can't be used to enumerate registered emails; the
      // frontend shouldn't accidentally leak that distinction back either.
      showError(err instanceof ApiError && err.status === 401
        ? "Invalid email or password."
        : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCode(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pendingToken) return;
    setSubmitting(true);
    try {
      await completeTotpLogin(
        pendingToken,
        useRecoveryCode ? { recoveryCode: code } : { code },
      );
      navigate("/dashboard", { replace: true });
    } catch (err) {
      showError(
        err instanceof ApiError && err.status === 401
          ? "Incorrect code."
          : err instanceof ApiError
            ? err.message
            : "Something went wrong. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (pendingToken) {
    return (
      <AuthShell eyebrow="Two-factor" headline="One more step — this account has 2FA enabled.">
        <h1>Enter your code</h1>
        <form onSubmit={onSubmitCode}>
          <label>
            {useRecoveryCode ? "Recovery code" : "6-digit code"}
            <input
              id="login-totp-code"
              type="text"
              inputMode={useRecoveryCode ? "text" : "numeric"}
              autocomplete="one-time-code"
              placeholder={useRecoveryCode ? "XXXX-XXXX" : "123456"}
              value={code}
              onInput={(e) => setCode(e.currentTarget.value)}
              autoFocus
              required
            />
          </label>
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting ? "Verifying…" : "Verify"}
          </button>
        </form>
        <p class="auth-switch">
          <button
            type="button"
            class="link-button"
            onClick={() => {
              setUseRecoveryCode((v) => !v);
              setCode("");
            }}
          >
            {useRecoveryCode ? "Use your authenticator app instead" : "Use a recovery code instead"}
          </button>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Welcome back" headline="Your checks have been quietly watching while you were away.">
      <h1>Log in to Vestal</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            id="login-email"
            type="email"
            autocomplete="email"
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            required
          />
        </label>
        <label>
          Password
          <input
            id="login-password"
            type="password"
            autocomplete="current-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            required
          />
        </label>
        <button type="submit" class="btn-primary" disabled={submitting}>
          {submitting ? "Logging in…" : "Log in"}
        </button>
      </form>
      <p class="auth-switch">
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
      <p class="auth-switch">
        Don't have an account? <Link to="/signup">Sign up</Link>
      </p>
    </AuthShell>
  );
}
