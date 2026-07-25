import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { useRouter, Link } from "../router";
import { ApiKeyReveal } from "../components/ApiKeyReveal";
import { AuthShell } from "../components/AuthShell";
import { TurnstileWidget } from "../components/TurnstileWidget";
import { ApiError } from "../api";
import { usePageMeta } from "../lib/seo";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export function Signup() {
  usePageMeta({
    title: "Sign up free",
    description: "Create a free Vestal account — unlimited backup verification checks and alerts, no card required.",
  });
  const { signup } = useAuth();
  const { showError } = useToast();
  const { navigate } = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  function validate(): string | null {
    if (!EMAIL_RE.test(email)) return "Enter a valid email address.";
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (password !== confirm) return "Passwords don't match.";
    if (!agreed) return "You need to agree to the Terms and Privacy Policy to continue.";
    if (!turnstileToken) return "Please complete the verification challenge.";
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
      const { api_key } = await signup(email, password, turnstileToken!);
      setRevealedKey(api_key);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (revealedKey) {
    return (
      <AuthShell
        eyebrow="One more thing"
        headline="This key opens the door. Copy it before you close this tab."
      >
        <h1>Account created</h1>
        <ApiKeyReveal apiKey={revealedKey} onAcknowledge={() => navigate("/dashboard", { replace: true })} />
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Get started"
      headline="Know your backups actually restore, not just that they ran."
    >
      <h1>Create your Vestal account</h1>
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input
            id="signup-email"
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
            id="signup-password"
            type="password"
            autocomplete="new-password"
            value={password}
            onInput={(e) => setPassword(e.currentTarget.value)}
            minLength={MIN_PASSWORD_LENGTH}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            id="signup-confirm-password"
            type="password"
            autocomplete="new-password"
            value={confirm}
            onInput={(e) => setConfirm(e.currentTarget.value)}
            required
          />
        </label>
        <label class="consent-check">
          <input
            id="signup-agree"
            type="checkbox"
            checked={agreed}
            onInput={(e) => setAgreed(e.currentTarget.checked)}
            required
          />
          <span>
            I agree to the <Link to="/terms">Terms</Link> and{" "}
            <Link to="/privacy">Privacy Policy</Link>.
          </span>
        </label>
        <TurnstileWidget onToken={setTurnstileToken} />
        <button type="submit" class="btn-primary" disabled={submitting || !turnstileToken}>
          {submitting ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p class="auth-switch">
        Already have an account? <Link to="/login">Log in</Link>
      </p>
    </AuthShell>
  );
}
