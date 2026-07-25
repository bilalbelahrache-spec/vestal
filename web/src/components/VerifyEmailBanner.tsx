import { useState } from "preact/hooks";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { api, ApiError } from "../api";

/** Non-blocking reminder, not a gate — the account already works fully
 * without verifying (see migrations/0006_email_verification.sql). Only
 * renders once we actually know the user is unverified, not during the
 * initial auth loading state. */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  if (!user || user.email_verified) return null;

  async function onResend() {
    setSending(true);
    try {
      await api.resendVerification();
      setSent(true);
      showSuccess("Verification email sent. Check your inbox.");
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't send the verification email.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div class="verify-banner">
      <span>Verify your email address so alerts and account notices reliably reach you.</span>
      <button type="button" class="btn-secondary btn-sm" onClick={onResend} disabled={sending || sent}>
        {sent ? "Sent" : sending ? "Sending…" : "Resend verification email"}
      </button>
    </div>
  );
}
