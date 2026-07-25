import type { Env } from "./types";

/**
 * Sender identity for outgoing mail. `vestalapp.com` is verified with
 * Resend (DKIM confirmed 2026-07-23) — this replaced the shared
 * `onboarding@resend.dev` testing address, which only worked for Resend's
 * own restricted test recipients. Real end-user delivery needed this.
 */
const FROM = "Vestal <alerts@vestalapp.com>";

/**
 * Sends one transactional email via the Resend API. Returns false (and
 * logs why) rather than throwing on any failure — a misconfigured or
 * rate-limited email provider shouldn't take down the request that
 * triggered it (a signup, a password-reset request, an alert dispatch);
 * same "log it, don't crash the caller" convention as the other alert
 * channels in alerts.ts.
 */
export async function sendEmail(
  env: Env,
  to: string,
  subject: string,
  text: string,
  html?: string,
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not configured — email to ${to} ("${subject}") not sent`);
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
  });

  if (!res.ok) {
    // Surface Resend's own error body (e.g. "you can only send testing
    // emails to your own email address") instead of just the status code —
    // this exact failure mode is expected until a domain is verified, and
    // the real reason matters for debugging via `wrangler tail`.
    const body = await res.text().catch(() => "");
    console.warn(`Resend email to ${to} failed (${res.status}): ${body}`);
    return false;
  }

  return true;
}
