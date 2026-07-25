import type { LedgerCoordinator } from "./ledger-coordinator";

export interface Env {
  DB: D1Database;
  /** Durable Object binding, one instance per user (routed via
   * `idFromName(userId)`) — serializes the read-last-hash/append sequence
   * for that user's verification-ledger chain so two concurrent pings
   * can't fork it. See src/ledger-coordinator.ts and
   * PRO_FEATURES_ROADMAP.md item 4. */
  LEDGER_COORDINATOR: DurableObjectNamespace<LedgerCoordinator>;
  /** Optional on purpose: local dev works without it (email sends just log
   * a warning and no-op), but it's set as a real secret in production. */
  RESEND_API_KEY?: string;
  /** Where self-monitoring alerts go (e.g. "the cron handler crashed") —
   * see the scheduled() handler in index.ts. Treated as a secret, not a
   * plain var, since this repo is public and a personal email address
   * shouldn't sit in a committed config file. */
  OWNER_EMAIL?: string;
  /** Cloudflare Turnstile's server-side verification secret (see
   * util.ts's verifyTurnstileToken). Optional for the same reason as
   * RESEND_API_KEY: local dev works without it configured (signup just
   * skips the check with a warning) but it's a real secret in production. */
  TURNSTILE_SECRET_KEY?: string;
  /** Bearer token for /api/admin/* — deliberately separate from user
   * accounts/API keys/sessions entirely (see src/admin.ts): there is no
   * user "role" system, so admin access is its own standalone secret
   * rather than a flag on some user row. Unset means the admin routes are
   * unreachable (401 on everything), not "open" — local dev without it
   * configured simply can't exercise them, same fail-closed default the
   * rest of the app doesn't otherwise need. */
  ADMIN_API_KEY?: string;
  /** Ed25519 private key (PKCS8, base64), one per environment — see
   * src/ledger.ts and scripts/generate-ledger-keypair.mjs. Optional like
   * the other secrets above: unset just means the ledger doesn't append
   * entries (pass/fail verification still works normally), not a hard
   * failure — same "local dev works without it" convention as the rest. */
  LEDGER_SIGNING_PRIVATE_KEY?: string;
  /** The matching public key (raw, base64) — NOT a secret, meant to be
   * published so a third party can independently verify a ledger export
   * without trusting Vestal's word for it. */
  LEDGER_SIGNING_PUBLIC_KEY?: string;
  /** Paddle (not Stripe — Stripe has no Morocco presence, see
   * migrations/0012_billing.sql) notification-destination secret, prefixed
   * `pdl_ntfset_`, used to verify the Paddle-Signature header on incoming
   * webhooks (see src/billing.ts). A real secret: unset means the webhook
   * route rejects everything rather than trusting unverified events —
   * fail-closed, same convention as ADMIN_API_KEY, not "optional" like the
   * best-effort integrations above. */
  PADDLE_WEBHOOK_SECRET?: string;
  /** Paddle's client-side token (starts `live_`/`test_`) — NOT a secret,
   * safe to hand to the browser. Served from GET /api/billing/config so
   * the frontend can initialize Paddle.js without it being baked into the
   * built bundle at compile time. */
  PADDLE_CLIENT_TOKEN?: string;
  /** The two Paddle price IDs for the Pro plan (each starts `pri_`),
   * created in the user's own Paddle dashboard under one "Vestal Pro"
   * product — monthly and annual are deliberately separate prices, not
   * one price with a quantity trick, since annual should be steered
   * toward (Paddle's ~5%+50c-per-transaction fee eats a much bigger share
   * of a $9 monthly charge than a $90 annual one — 12 fee-hits/year vs 1). */
  PADDLE_PRICE_ID_MONTHLY?: string;
  PADDLE_PRICE_ID_ANNUAL?: string;
  /** The Team tier's two Paddle price IDs, same monthly/annual split as
   * Pro above, created under a separate "Vestal Team" product in the same
   * Paddle account. Optional: unset means Team checkout just isn't offered
   * (Organizations.tsx falls back to the existing >5-clients Pro ceiling
   * with no upgrade path shown), not a hard failure — same "best-effort
   * until configured" convention as the other optional secrets here. */
  PADDLE_PRICE_ID_TEAM_MONTHLY?: string;
  PADDLE_PRICE_ID_TEAM_ANNUAL?: string;
  /** "sandbox" or "production" — which Paddle environment Paddle.js should
   * talk to. Defaults to "sandbox" when unset (see src/billing.ts) so a
   * misconfigured production deploy fails safe into test mode rather than
   * silently taking real payments. */
  PADDLE_ENVIRONMENT?: string;
  /** Paddle's server-side API key (starts `pdl_{sdbx,live}_apikey_...`) —
   * a real secret, distinct from the client-side token above. Used only
   * for POST /api/billing/cancel (src/index.ts), which calls Paddle's own
   * "cancel subscription" API on the user's behalf. Optional like the
   * other best-effort secrets: unset just means self-serve cancellation
   * is unavailable (the endpoint 501s with a clear message), not a hard
   * failure — email-based cancellation still works either way. */
  PADDLE_API_KEY?: string;
}

export type CheckStatus = "new" | "pass" | "fail" | "late";
export type PingStatus = "pass" | "fail" | "start";
export type AlertChannelKind = "discord" | "webhook" | "slack" | "email";
export type Backend = "restic" | "borg" | "duplicati" | "kopia" | "archive" | "other";

/** "team" is a strict superset of "pro" (see isProUser in billing.ts) —
 * every Pro feature plus a higher per-organization client ceiling (see
 * FREE_ORG_CLIENT_LIMIT in index.ts). It's a separate Paddle price/product,
 * not a flag on top of Pro, since it's billed at a different amount. */
export type Plan = "free" | "pro" | "team";

export interface UserRow {
  id: string;
  email: string;
  api_key_hash: string;
  password_hash: string;
  email_verified_at: number | null;
  totp_secret: string | null;
  totp_secret_pending: string | null;
  plan: Plan;
  paddle_customer_id: string | null;
  paddle_subscription_id: string | null;
  plan_updated_at: number | null;
  created_at: number;
}

export interface SessionRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}

export interface CheckRow {
  id: string;
  user_id: string;
  name: string;
  backend: Backend;
  ping_token: string;
  expected_interval_seconds: number;
  grace_period_seconds: number;
  last_ping_at: number | null;
  last_status: CheckStatus;
  last_alerted_at: number | null;
  last_anomaly_at: number | null;
  last_anomaly_score: number | null;
  flagged_archive_file_count: number;
  config_audit_warning_count: number;
  last_drill_at: number | null;
  last_drill_status: "pass" | "fail" | null;
  last_drill_duration_ms: number | null;
  drill_interval_seconds: number | null;
  last_drill_reminder_at: number | null;
  organization_id: string | null;
  client_id: string | null;
  created_at: number;
}

// --- MSP / Team tier — see migrations/0014_organizations.sql. ------------

export type OrganizationRole = "owner" | "member";

export interface OrganizationRow {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: number;
}

export interface OrganizationMemberRow {
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  created_at: number;
}

export interface ClientRow {
  id: string;
  organization_id: string;
  name: string;
  created_at: number;
}

/** Invite-by-email for someone without a Vestal account yet — see
 * migrations/0016_organization_invites.sql. */
export interface OrganizationInviteRow {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  invited_by_user_id: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
}

/** One restore-drill run — see migrations/0013_restore_drills.sql and
 * PRO_FEATURES_ROADMAP.md item 5. */
export interface DrillRunRow {
  id: string;
  check_id: string;
  status: "pass" | "fail";
  duration_ms: number;
  files_restored: number | null;
  files_expected: number | null;
  message: string | null;
  created_at: number;
}

/** One verification run's change-volume stats, from the agent's diff
 * against the backend's own previous snapshot/archive — see
 * migrations/0008 and src/anomaly.ts for how this gets scored. */
export interface DiffStatSample {
  files_changed: number;
  files_added: number;
  files_removed: number;
  ext_change_count: number;
}

export interface AlertChannelRow {
  id: string;
  user_id: string;
  kind: AlertChannelKind;
  target: string;
  created_at: number;
}

export interface PasswordResetTokenRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

/** Same shape as PasswordResetTokenRow, kept as a separate table/type
 * since the two have different lifecycle rules in practice (see
 * migrations/0006_email_verification.sql) even though the columns match
 * today. */
export interface EmailVerificationTokenRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

export interface PendingTwoFactorLoginRow {
  id: string;
  user_id: string;
  created_at: number;
  expires_at: number;
}
