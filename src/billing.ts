/**
 * Paddle billing — see PRO_FEATURES_ROADMAP.md's billing note and
 * migrations/0012_billing.sql. Paddle, not Stripe: Stripe has no Morocco
 * presence (no account creation, no payouts to a Moroccan bank), confirmed
 * 2026-07-24 — this isn't a preference, it's the only option that actually
 * works for this business. Paddle is a Merchant of Record: it handles
 * global sales tax/VAT and pays Vestal out, at the cost of a higher
 * transaction fee than Stripe would charge (~5%+ vs ~2.9%) — a real,
 * permanent, accepted tradeoff, not an oversight.
 *
 * Signature verification below implements Paddle's own documented
 * algorithm exactly (developer.paddle.com/webhooks/about/signature-
 * verification, fetched 2026-07-24, not guessed from memory): the
 * `Paddle-Signature` header is `ts=<unix_seconds>;h1=<hex_hmac>`, and the
 * signed payload is the literal string `${ts}:${rawBody}`, HMAC-SHA256'd
 * with the notification destination's secret (`pdl_ntfset_...`). Paddle's
 * own SDKs reject anything more than 5 seconds old as replay protection;
 * this does the same, per that same doc.
 */

import type { Plan, UserRow } from "./types";
import { timingSafeEqualStrings } from "./util";

const REPLAY_TOLERANCE_SECONDS = 5;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface PaddleSignatureCheck {
  valid: boolean;
  reason: string | null;
}

/**
 * Verifies a Paddle webhook's `Paddle-Signature` header against the raw
 * (unparsed) request body. Must be called with the body exactly as
 * received — re-serializing JSON before this check silently breaks
 * verification (Paddle's docs call this out explicitly as the most common
 * integration bug), so callers must read the body as text first and only
 * `JSON.parse` it after this returns valid.
 */
export async function verifyPaddleWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): Promise<PaddleSignatureCheck> {
  if (!signatureHeader) return { valid: false, reason: "missing Paddle-Signature header" };

  const parts = Object.fromEntries(
    signatureHeader.split(";").map((part) => {
      const eq = part.indexOf("=");
      return [part.slice(0, eq), part.slice(eq + 1)];
    }),
  );
  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return { valid: false, reason: "malformed Paddle-Signature header" };

  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { valid: false, reason: "malformed timestamp" };
  if (Math.abs(nowSeconds - tsNum) > REPLAY_TOLERANCE_SECONDS) {
    return { valid: false, reason: "timestamp outside replay-protection tolerance" };
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signedPayload = `${ts}:${rawBody}`;
  const computed = toHex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload)));

  if (!timingSafeEqualStrings(computed, h1)) {
    return { valid: false, reason: "signature does not match" };
  }
  return { valid: true, reason: null };
}

/** Subscription statuses Paddle uses that should keep/grant Pro access. A
 * subscription can also be "past_due" (payment failed, Paddle is retrying)
 * or "paused"/"canceled" — those are deliberately NOT in this set, so a
 * failed payment demotes the account rather than leaving Pro access
 * granted indefinitely on an unpaid subscription. */
const ACTIVE_STATUSES = new Set(["active", "trialing"]);

export interface PaddleSubscriptionEventData {
  id: string; // subscription id, e.g. "sub_..."
  status: string;
  customer_id: string;
  custom_data?: { user_id?: string } | null;
  /** The subscribed price's id (`data.items[0].price.id` in Paddle's
   * webhook payload) — the only way to tell a Team checkout apart from a
   * Pro one, since both fire the same `subscription.*` event types. Null
   * when the payload doesn't include it (older/malformed events): treated
   * as "not Team," never crashes the update. */
  price_id?: string | null;
}

/** The Team tier's two price ids, passed in from Env by the caller rather
 * than imported directly — keeps this module free of any Cloudflare-specific
 * type so it stays trivially unit-testable (see tests/billing.spec.ts). */
export interface TeamPriceIds {
  monthly?: string;
  annual?: string;
}

export interface DerivedPlanUpdate {
  plan: Plan;
  paddleCustomerId: string;
  paddleSubscriptionId: string;
  /** Only present on the event that first links a Paddle customer to a
   * Vestal account (via custom_data.user_id passed at checkout) — later
   * events for the same subscription (e.g. a renewal) look the user up by
   * paddle_customer_id instead, since custom_data isn't guaranteed to be
   * resent on every event type. Null means "can't tell who this belongs
   * to yet," which callers must treat as a no-op, not a guess. */
  userId: string | null;
}

/** Turns a Paddle `subscription.*` webhook's `data` object into a plan
 * update — the event *type* (created/updated/activated/canceled/...)
 * doesn't need to be switched on individually, since `data.status` is
 * already the authoritative current state regardless of which event
 * carried it. `teamPriceIds` distinguishes a Team checkout from a Pro one
 * (both are otherwise identical `subscription.*` events) — an active
 * subscription defaults to "pro" unless its price id matches one of the
 * two Team prices, so an unconfigured/missing teamPriceIds behaves exactly
 * like before Team existed. */
export function derivePlanUpdate(
  data: PaddleSubscriptionEventData,
  teamPriceIds?: TeamPriceIds,
): DerivedPlanUpdate {
  const isActive = ACTIVE_STATUSES.has(data.status);
  const isTeamPrice =
    isActive &&
    !!data.price_id &&
    (data.price_id === teamPriceIds?.monthly || data.price_id === teamPriceIds?.annual);

  return {
    plan: isTeamPrice ? "team" : isActive ? "pro" : "free",
    paddleCustomerId: data.customer_id,
    paddleSubscriptionId: data.id,
    userId: data.custom_data?.user_id ?? null,
  };
}

/** The single gate every Pro-or-better code path checks — kept as one
 * function so "what counts as at least Pro" is defined in exactly one
 * place. Team is a strict superset of Pro (see the Plan type), so it
 * passes this gate too. */
export function isProUser(user: Pick<UserRow, "plan"> | null): boolean {
  return user?.plan === "pro" || user?.plan === "team";
}

/** Team-only gate, e.g. the per-organization client ceiling in index.ts —
 * deliberately separate from isProUser rather than a second parameter on
 * it, so a call site has to explicitly ask for the stricter check. */
export function isTeamUser(user: Pick<UserRow, "plan"> | null): boolean {
  return user?.plan === "team";
}

export const PRO_UPGRADE_MESSAGE =
  "This is a Pro feature. Upgrade in the dashboard to turn it on for this check.";

/** Paddle runs sandbox and live as genuinely separate API hosts, not a
 * header/flag on one shared host — same split as the dashboard logins
 * (sandbox-vendors.paddle.com vs vendors.paddle.com). */
export function paddleApiBaseUrl(environment: string | undefined): string {
  return environment === "production" ? "https://api.paddle.com" : "https://sandbox-api.paddle.com";
}
