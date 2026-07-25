import type { Env } from "./types";

/**
 * Verifies a Cloudflare Turnstile token server-side — the client-side
 * widget alone proves nothing by itself; the widget's output token has to
 * be checked against Cloudflare's own /siteverify endpoint, which is the
 * only source of truth for "did a real browser actually solve this."
 *
 * Fails open (returns true, logging a warning) when TURNSTILE_SECRET_KEY
 * isn't configured — same convention as sendEmail()'s RESEND_API_KEY
 * check: local dev works without every production secret wired up. In
 * production the secret is always set, so this branch never fires there.
 */
export async function verifyTurnstileToken(
  env: Env,
  token: string | undefined,
  remoteIp: string,
): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) {
    console.warn("TURNSTILE_SECRET_KEY not configured — skipping Turnstile verification");
    return true;
  }
  if (!token) return false;

  const body = new URLSearchParams();
  body.set("secret", env.TURNSTILE_SECRET_KEY);
  body.set("response", token);
  if (remoteIp !== "unknown") body.set("remoteip", remoteIp);

  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const result = await res.json<{ success: boolean }>();
    return result.success === true;
  } catch (err) {
    // A Cloudflare-to-Cloudflare call failing is almost certainly transient
    // network trouble, not a real forged token — fail closed regardless,
    // since silently letting signups through during an outage defeats the
    // point of having this check at all.
    console.warn("Turnstile verification request failed:", err);
    return false;
  }
}
