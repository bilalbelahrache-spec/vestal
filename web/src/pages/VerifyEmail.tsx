import { useEffect, useState } from "preact/hooks";
import { AuthShell } from "../components/AuthShell";
import { Link } from "../router";
import { api, ApiError } from "../api";
import { useAuth } from "../context/auth";

/** Reads the token from the query string directly, same reasoning as
 * ResetPassword.tsx: the hand-rolled router matches on pathname only. */
function tokenFromLocation(): string {
  return new URLSearchParams(window.location.search).get("token") ?? "";
}

type Status = "verifying" | "success" | "error";

export function VerifyEmail() {
  const [token] = useState(tokenFromLocation);
  const [status, setStatus] = useState<Status>(token ? "verifying" : "error");
  const [errorMessage, setErrorMessage] = useState("");
  const { refresh } = useAuth();

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        await api.verifyEmail(token);
        if (cancelled) return;
        setStatus("success");
        // Picks up the now-verified state for the banner on /dashboard
        // without needing a hard reload.
        refresh().catch(() => {});
      } catch (err) {
        if (cancelled) return;
        setErrorMessage(err instanceof ApiError ? err.message : "Something went wrong.");
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (status === "verifying") {
    return (
      <AuthShell eyebrow="One moment" headline="Confirming this is really your inbox.">
        <h1>Verifying your email…</h1>
      </AuthShell>
    );
  }

  if (status === "error") {
    return (
      <AuthShell eyebrow="Verify email" headline="That link didn't work.">
        <h1>Verification failed</h1>
        <p>
          {token
            ? errorMessage || "This link is invalid or has expired."
            : "This link is missing its token. It may have been copied incorrectly."}
        </p>
        <p class="auth-switch">
          <Link to="/dashboard">Back to dashboard</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell eyebrow="Verified" headline="Your inbox is confirmed.">
      <h1>Email verified</h1>
      <p>Alerts and account emails are confirmed to reach this address.</p>
      <p class="auth-switch">
        <Link to="/dashboard">Continue to dashboard</Link>
      </p>
    </AuthShell>
  );
}
