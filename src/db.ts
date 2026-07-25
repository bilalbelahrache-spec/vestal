import type { ArchiveFileRecord, StoredArchiveFile } from "./archive";
import { evaluateArchiveFile } from "./archive";
import type { AuditFinding } from "./audit-rules";
import type {
  AlertChannelRow,
  CheckRow,
  CheckStatus,
  ClientRow,
  DiffStatSample,
  DrillRunRow,
  EmailVerificationTokenRow,
  Env,
  OrganizationInviteRow,
  OrganizationMemberRow,
  OrganizationRole,
  OrganizationRow,
  PasswordResetTokenRow,
  PendingTwoFactorLoginRow,
  PingStatus,
  SessionRow,
  UserRow,
} from "./types";
import {
  hashApiKey,
  hashRecoveryCode,
  nowSeconds,
  pingToken,
  resetToken,
  sessionToken,
  uuid,
} from "./util";

// Same lifetime as a password reset link is short-lived for a different
// reason (see that constant) — this is long-lived instead, since there's
// no urgency forcing someone to accept an org invite fast, and unlike a
// password reset, missing the window here doesn't lock anyone out of
// their own account. 14 days, same order of magnitude as most SaaS team
// invites.
const ORGANIZATION_INVITE_LIFETIME_SECONDS = 14 * 24 * 60 * 60;

const SESSION_LIFETIME_SECONDS = 30 * 24 * 60 * 60; // 30 days
const RESET_TOKEN_LIFETIME_SECONDS = 60 * 60; // 1 hour — short-lived on purpose, it's emailed in plaintext
const EMAIL_VERIFICATION_TOKEN_LIFETIME_SECONDS = 24 * 60 * 60; // 24 hours — longer than a password reset since there's no urgency driving someone to click it fast
const PENDING_2FA_LOGIN_LIFETIME_SECONDS = 5 * 60; // 5 minutes — long enough to type a 6-digit code, short enough not to matter if abandoned

export async function getUserByApiKey(
  env: Env,
  apiKey: string,
): Promise<UserRow | null> {
  const hash = await hashApiKey(apiKey);
  return env.DB.prepare("SELECT * FROM users WHERE api_key_hash = ?")
    .bind(hash)
    .first<UserRow>();
}

export async function getUserByEmail(env: Env, email: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function getUserById(env: Env, id: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function createUser(
  env: Env,
  email: string,
  apiKey: string,
  passwordHash: string,
): Promise<UserRow> {
  const row: UserRow = {
    id: uuid(),
    email,
    api_key_hash: await hashApiKey(apiKey),
    password_hash: passwordHash,
    email_verified_at: null,
    totp_secret: null,
    totp_secret_pending: null,
    plan: "free",
    paddle_customer_id: null,
    paddle_subscription_id: null,
    plan_updated_at: null,
    created_at: nowSeconds(),
  };
  await env.DB.prepare(
    "INSERT INTO users (id, email, api_key_hash, password_hash, email_verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.email, row.api_key_hash, row.password_hash, row.email_verified_at, row.created_at)
    .run();
  return row;
}

/** Rotates a user's API key without touching their login (password/session). */
export async function regenerateApiKey(env: Env, userId: string, newApiKey: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET api_key_hash = ? WHERE id = ?")
    .bind(await hashApiKey(newApiKey), userId)
    .run();
}

export async function createSession(env: Env, userId: string): Promise<SessionRow> {
  const now = nowSeconds();
  const row: SessionRow = {
    id: sessionToken(),
    user_id: userId,
    created_at: now,
    expires_at: now + SESSION_LIFETIME_SECONDS,
  };
  await env.DB.prepare(
    "INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(row.id, row.user_id, row.created_at, row.expires_at)
    .run();
  return row;
}

export async function getUserBySessionToken(env: Env, token: string): Promise<UserRow | null> {
  return env.DB.prepare(
    `SELECT users.* FROM users
       JOIN sessions ON sessions.user_id = users.id
      WHERE sessions.id = ? AND sessions.expires_at > ?`,
  )
    .bind(token, nowSeconds())
    .first<UserRow>();
}

export async function deleteSession(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(token).run();
}

export async function createCheck(
  env: Env,
  userId: string,
  params: {
    name: string;
    backend: string;
    expectedIntervalSeconds: number;
    gracePeriodSeconds?: number;
    organizationId?: string | null;
    clientId?: string | null;
    drillIntervalSeconds?: number | null;
  },
): Promise<CheckRow> {
  const row: CheckRow = {
    id: uuid(),
    user_id: userId,
    name: params.name,
    backend: params.backend as CheckRow["backend"],
    ping_token: pingToken(),
    expected_interval_seconds: params.expectedIntervalSeconds,
    grace_period_seconds: params.gracePeriodSeconds ?? 3600,
    last_ping_at: null,
    last_status: "new",
    last_alerted_at: null,
    last_anomaly_at: null,
    last_anomaly_score: null,
    flagged_archive_file_count: 0,
    config_audit_warning_count: 0,
    last_drill_at: null,
    last_drill_status: null,
    last_drill_duration_ms: null,
    drill_interval_seconds: params.drillIntervalSeconds ?? null,
    last_drill_reminder_at: null,
    organization_id: params.organizationId ?? null,
    client_id: params.clientId ?? null,
    created_at: nowSeconds(),
  };
  await env.DB.prepare(
    `INSERT INTO checks
      (id, user_id, name, backend, ping_token, expected_interval_seconds,
       grace_period_seconds, last_ping_at, last_status, last_alerted_at,
       organization_id, client_id, drill_interval_seconds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.user_id,
      row.name,
      row.backend,
      row.ping_token,
      row.expected_interval_seconds,
      row.grace_period_seconds,
      row.last_ping_at,
      row.last_status,
      row.last_alerted_at,
      row.organization_id,
      row.client_id,
      row.drill_interval_seconds,
      row.created_at,
    )
    .run();
  return row;
}

export async function listChecksForUser(
  env: Env,
  userId: string,
): Promise<CheckRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM checks WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(userId)
    .all<CheckRow>();
  return results;
}

export async function countChecksForUser(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM checks WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Scoped to the owning user — returns whether a row was actually deleted. */
export async function deleteCheck(env: Env, checkId: string, userId: string): Promise<boolean> {
  const { meta } = await env.DB.prepare("DELETE FROM checks WHERE id = ? AND user_id = ?")
    .bind(checkId, userId)
    .run();
  return meta.changes > 0;
}

export async function getCheckByPingToken(
  env: Env,
  token: string,
): Promise<CheckRow | null> {
  return env.DB.prepare("SELECT * FROM checks WHERE ping_token = ?")
    .bind(token)
    .first<CheckRow>();
}

/** Unscoped by user — only for the public status badge route, which is
 * deliberately unauthenticated (see src/badge.ts). `id` is a
 * crypto.randomUUID() (122 bits of entropy), not practically guessable, and
 * reading it only exposes pass/fail/last-ping-time, which is exactly what
 * the badge is FOR showing publicly — same threat model as the public
 * ledger key, not a new exposure. Every other route that touches a check
 * must keep using listChecksForUser/deleteCheck's ownership-scoped queries;
 * this one is the sole intentional exception. */
export async function getCheckById(env: Env, id: string): Promise<CheckRow | null> {
  return env.DB.prepare("SELECT * FROM checks WHERE id = ?").bind(id).first<CheckRow>();
}

export async function recordPing(
  env: Env,
  check: CheckRow,
  status: PingStatus,
  message: string | null,
  durationMs: number | null,
): Promise<void> {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO pings (id, check_id, status, message, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(uuid(), check.id, status, message, durationMs, now),
    env.DB.prepare(
      `UPDATE checks
         SET last_ping_at = ?,
             last_status = ?,
             last_alerted_at = NULL
       WHERE id = ?`,
    ).bind(
      now,
      status === "start" ? check.last_status : status,
      check.id,
    ),
  ]);
}

/**
 * The core of the product: any check that needs alerting and hasn't
 * already been alerted on for the current problem. Runs on the cron
 * trigger every 5 minutes. Two distinct ways a check ends up here:
 *
 *  - An explicit failure ping (`/fail`) always qualifies immediately,
 *    regardless of timing — a fail ping *refreshes* last_ping_at (it's
 *    still a real check-in), so it would otherwise look freshly-pinged
 *    and get missed by the time-based branch below for up to a full
 *    interval. The whole point of an explicit fail signal is "alert now,"
 *    not "alert whenever this would've gone quiet anyway."
 *  - No ping (or no failure) within the expected window + grace period —
 *    the "gone silent" case.
 */
export async function findOverdueChecks(env: Env): Promise<CheckRow[]> {
  const now = nowSeconds();
  const { results } = await env.DB.prepare(
    `SELECT * FROM checks
      WHERE last_alerted_at IS NULL
        AND (
          last_status = 'fail'
          OR
          -- never pinged, and it's been longer than the grace-adjusted window since creation
          (last_ping_at IS NULL AND ? - created_at > expected_interval_seconds + grace_period_seconds)
          OR
          -- pinged before, but it's overdue now
          (last_ping_at IS NOT NULL AND ? - last_ping_at > expected_interval_seconds + grace_period_seconds)
        )`,
  )
    .bind(now, now)
    .all<CheckRow>();
  return results;
}

// --- Ransomware / anomaly canary ------------------------------------------
// See migrations/0008_anomaly_detection.sql and src/anomaly.ts.

// Enough runs to establish a stable per-check baseline (see
// MIN_BASELINE_SAMPLES in anomaly.ts) while staying well clear of unbounded
// growth — pruned back to this count on every insert, per-check, below.
const DIFF_STATS_ROLLING_WINDOW = 60;

export async function getRecentDiffStats(
  env: Env,
  checkId: string,
  limit: number,
): Promise<DiffStatSample[]> {
  const { results } = await env.DB.prepare(
    `SELECT files_changed, files_added, files_removed, ext_change_count
       FROM diff_stats WHERE check_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(checkId, limit)
    .all<DiffStatSample>();
  return results;
}

/** Records one run's diff stats and prunes the same check's history back to
 * DIFF_STATS_ROLLING_WINDOW rows — a rolling window, not an unbounded log
 * (see migrations/0008's comment for why). `anomalyScore` is whatever
 * scoreAnomaly() returned for this sample (null if there wasn't yet enough
 * baseline to score it). */
export async function recordDiffStats(
  env: Env,
  checkId: string,
  sample: DiffStatSample,
  anomalyScore: number | null,
): Promise<void> {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO diff_stats
        (id, check_id, files_changed, files_added, files_removed, ext_change_count, anomaly_score, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      uuid(),
      checkId,
      sample.files_changed,
      sample.files_added,
      sample.files_removed,
      sample.ext_change_count,
      anomalyScore,
      now,
    ),
    env.DB.prepare(
      `DELETE FROM diff_stats WHERE check_id = ? AND id NOT IN (
         SELECT id FROM diff_stats WHERE check_id = ? ORDER BY created_at DESC LIMIT ?
       )`,
    ).bind(checkId, checkId, DIFF_STATS_ROLLING_WINDOW),
  ]);
}

export async function markAnomaly(env: Env, checkId: string, score: number): Promise<void> {
  await env.DB.prepare("UPDATE checks SET last_anomaly_at = ?, last_anomaly_score = ? WHERE id = ?")
    .bind(nowSeconds(), score, checkId)
    .run();
}

/** A single flagged run shouldn't leave a permanent "anomaly!" badge on the
 * dashboard forever — once a run is actually scored (not "not enough
 * history yet") and comes back clean, clear it, same as how a check's
 * normal pass/fail status already updates on every ping rather than
 * sticking at the worst thing that ever happened. */
export async function clearAnomaly(env: Env, checkId: string): Promise<void> {
  await env.DB.prepare("UPDATE checks SET last_anomaly_at = NULL, last_anomaly_score = NULL WHERE id = ?")
    .bind(checkId)
    .run();
}

export async function markAlerted(
  env: Env,
  checkId: string,
  status: CheckStatus,
): Promise<void> {
  await env.DB.prepare(
    "UPDATE checks SET last_alerted_at = ?, last_status = ? WHERE id = ?",
  )
    .bind(nowSeconds(), status, checkId)
    .run();
}

export async function listAlertChannelsForUser(
  env: Env,
  userId: string,
): Promise<AlertChannelRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM alert_channels WHERE user_id = ?",
  )
    .bind(userId)
    .all<AlertChannelRow>();
  return results;
}

/**
 * Every ping the user's checks have ever recorded, most recent first, up
 * to `limit` — used only by the data-export endpoint (GET
 * /api/account/export). Bounded rather than truly unlimited: there's no
 * retention/pruning policy on `pings` today, so a long-lived heavy account
 * could in principle have an unbounded number of rows, and this endpoint
 * shouldn't be the thing that turns that into an unbounded-size response.
 */
export async function listPingsForUser(
  env: Env,
  userId: string,
  limit: number,
): Promise<Array<{ id: string; check_id: string; status: PingStatus; message: string | null; duration_ms: number | null; created_at: number }>> {
  const { results } = await env.DB.prepare(
    `SELECT pings.id, pings.check_id, pings.status, pings.message, pings.duration_ms, pings.created_at
       FROM pings
       JOIN checks ON checks.id = pings.check_id
      WHERE checks.user_id = ?
      ORDER BY pings.created_at DESC
      LIMIT ?`,
  )
    .bind(userId, limit)
    .all<{ id: string; check_id: string; status: PingStatus; message: string | null; duration_ms: number | null; created_at: number }>();
  return results;
}

export async function countAlertChannelsForUser(env: Env, userId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM alert_channels WHERE user_id = ?")
    .bind(userId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createAlertChannel(
  env: Env,
  userId: string,
  kind: string,
  target: string,
): Promise<AlertChannelRow> {
  const row: AlertChannelRow = {
    id: uuid(),
    user_id: userId,
    kind: kind as AlertChannelRow["kind"],
    target,
    created_at: nowSeconds(),
  };
  await env.DB.prepare(
    "INSERT INTO alert_channels (id, user_id, kind, target, created_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.user_id, row.kind, row.target, row.created_at)
    .run();
  return row;
}

/** Scoped to the owning user — returns whether a row was actually deleted. */
export async function deleteAlertChannel(env: Env, channelId: string, userId: string): Promise<boolean> {
  const { meta } = await env.DB.prepare("DELETE FROM alert_channels WHERE id = ? AND user_id = ?")
    .bind(channelId, userId)
    .run();
  return meta.changes > 0;
}

/**
 * Permanently deletes a user and everything they own: pings, checks, alert
 * channels, sessions, then the account row itself. The schema already
 * declares `ON DELETE CASCADE` on all four, but that only fires if SQLite's
 * `PRAGMA foreign_keys` is on for the connection D1 hands us — rather than
 * assume that's true, every table is deleted explicitly in one atomic
 * batch, so this works regardless of whether the pragma is enabled.
 */
export async function deleteUser(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM pings WHERE check_id IN (SELECT id FROM checks WHERE user_id = ?)",
    ).bind(userId),
    env.DB.prepare("DELETE FROM checks WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM alert_channels WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM pending_2fa_logins WHERE user_id = ?").bind(userId),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
}

export async function updateUserPassword(
  env: Env,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await env.DB.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .bind(passwordHash, userId)
    .run();
}

/** Invalidates every existing session for a user — used after a password
 * reset, in case the old password (and any session it protects) was
 * compromised; forces a fresh login everywhere with the new password. */
export async function deleteAllSessionsForUser(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function createPasswordResetToken(
  env: Env,
  userId: string,
): Promise<PasswordResetTokenRow> {
  const now = nowSeconds();
  const row: PasswordResetTokenRow = {
    id: resetToken(),
    user_id: userId,
    created_at: now,
    expires_at: now + RESET_TOKEN_LIFETIME_SECONDS,
    used_at: null,
  };
  await env.DB.prepare(
    "INSERT INTO password_reset_tokens (id, user_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.user_id, row.created_at, row.expires_at, row.used_at)
    .run();
  return row;
}

/** Null if the token doesn't exist, is expired, or was already used —
 * callers don't need to distinguish which, all three mean "not valid." */
export async function getValidPasswordResetToken(
  env: Env,
  token: string,
): Promise<PasswordResetTokenRow | null> {
  return env.DB.prepare(
    "SELECT * FROM password_reset_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?",
  )
    .bind(token, nowSeconds())
    .first<PasswordResetTokenRow>();
}

export async function consumePasswordResetToken(env: Env, token: string): Promise<void> {
  await env.DB.prepare("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?")
    .bind(nowSeconds(), token)
    .run();
}

export async function createEmailVerificationToken(
  env: Env,
  userId: string,
): Promise<EmailVerificationTokenRow> {
  const now = nowSeconds();
  const row: EmailVerificationTokenRow = {
    id: resetToken(), // same random-token shape as a password reset token; no reason for a distinct generator
    user_id: userId,
    created_at: now,
    expires_at: now + EMAIL_VERIFICATION_TOKEN_LIFETIME_SECONDS,
    used_at: null,
  };
  await env.DB.prepare(
    "INSERT INTO email_verification_tokens (id, user_id, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, ?)",
  )
    .bind(row.id, row.user_id, row.created_at, row.expires_at, row.used_at)
    .run();
  return row;
}

/** Null if the token doesn't exist, is expired, or was already used. */
export async function getValidEmailVerificationToken(
  env: Env,
  token: string,
): Promise<EmailVerificationTokenRow | null> {
  return env.DB.prepare(
    "SELECT * FROM email_verification_tokens WHERE id = ? AND used_at IS NULL AND expires_at > ?",
  )
    .bind(token, nowSeconds())
    .first<EmailVerificationTokenRow>();
}

export async function consumeEmailVerificationToken(env: Env, token: string): Promise<void> {
  await env.DB.prepare("UPDATE email_verification_tokens SET used_at = ? WHERE id = ?")
    .bind(nowSeconds(), token)
    .run();
}

export async function markEmailVerified(env: Env, userId: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET email_verified_at = ? WHERE id = ?")
    .bind(nowSeconds(), userId)
    .run();
}

// --- TOTP two-factor auth --------------------------------------------------

export async function setPendingTotpSecret(env: Env, userId: string, secret: string): Promise<void> {
  await env.DB.prepare("UPDATE users SET totp_secret_pending = ? WHERE id = ?")
    .bind(secret, userId)
    .run();
}

/** Promotes the pending secret to the live one — called only after the
 * caller has verified a real code against it (see POST /api/totp/confirm),
 * proving the user's app actually has the right secret. */
export async function enableTotp(env: Env, userId: string, secret: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE users SET totp_secret = ?, totp_secret_pending = NULL WHERE id = ?",
  )
    .bind(secret, userId)
    .run();
}

export async function disableTotp(env: Env, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE users SET totp_secret = NULL, totp_secret_pending = NULL WHERE id = ?",
    ).bind(userId),
    env.DB.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ?").bind(userId),
  ]);
}

/** Replaces the entire recovery-code set — any codes issued before this
 * call stop working, same "regenerating invalidates the old one" rule as
 * API key regeneration. Returns the plaintext codes; only the hash is
 * stored, so this is the only moment they're ever visible again. */
export async function replaceRecoveryCodes(
  env: Env,
  userId: string,
  plaintextCodes: string[],
): Promise<void> {
  const now = nowSeconds();
  const inserts = await Promise.all(
    plaintextCodes.map(async (code) =>
      env.DB.prepare(
        "INSERT INTO totp_recovery_codes (id, user_id, code_hash, used_at, created_at) VALUES (?, ?, ?, NULL, ?)",
      ).bind(uuid(), userId, await hashRecoveryCode(code), now),
    ),
  );
  await env.DB.batch([
    env.DB.prepare("DELETE FROM totp_recovery_codes WHERE user_id = ?").bind(userId),
    ...inserts,
  ]);
}

/** Marks one matching, unused recovery code as used and returns true — or
 * returns false without changing anything if the code doesn't match any
 * unused code for this user. */
export async function consumeRecoveryCode(env: Env, userId: string, plaintextCode: string): Promise<boolean> {
  const hash = await hashRecoveryCode(plaintextCode);
  const row = await env.DB.prepare(
    "SELECT id FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL",
  )
    .bind(userId, hash)
    .first<{ id: string }>();
  if (!row) return false;
  const { meta } = await env.DB.prepare(
    "UPDATE totp_recovery_codes SET used_at = ? WHERE id = ? AND used_at IS NULL",
  )
    .bind(nowSeconds(), row.id)
    .run();
  return meta.changes > 0;
}

export async function createPending2faLogin(env: Env, userId: string): Promise<PendingTwoFactorLoginRow> {
  const now = nowSeconds();
  const row: PendingTwoFactorLoginRow = {
    id: sessionToken(), // same random-token shape as a session id; no reason for a distinct generator
    user_id: userId,
    created_at: now,
    expires_at: now + PENDING_2FA_LOGIN_LIFETIME_SECONDS,
  };
  await env.DB.prepare(
    "INSERT INTO pending_2fa_logins (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  )
    .bind(row.id, row.user_id, row.created_at, row.expires_at)
    .run();
  return row;
}

/** Non-destructive on purpose — a wrong code shouldn't burn the pending
 * login, since the user needs to be able to retry within the 5-minute
 * window (see PENDING_2FA_LOGIN_LIFETIME_SECONDS). Only a *successful*
 * verification should consume it (see deletePending2faLogin). */
export async function getValidPending2faLogin(env: Env, token: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT user_id FROM pending_2fa_logins WHERE id = ? AND expires_at > ?",
  )
    .bind(token, nowSeconds())
    .first<{ user_id: string }>();
  return row?.user_id ?? null;
}

export async function deletePending2faLogin(env: Env, token: string): Promise<void> {
  await env.DB.prepare("DELETE FROM pending_2fa_logins WHERE id = ?").bind(token).run();
}

// --- Admin ------------------------------------------------------------
// Read-only overview queries for /api/admin/* (see src/admin.ts for the
// access-control gate) — deliberately correlated subqueries rather than a
// join-and-group-by: this product's user count is nowhere near the scale
// where that matters, and per-user subqueries are far easier to read and
// verify correct than a multi-table GROUP BY that has to get COUNT
// DISTINCT/duplication right across two independent one-to-many joins
// (checks and alert_channels) at once.

export interface AdminUserSummary {
  id: string;
  email: string;
  created_at: number;
  email_verified: boolean;
  totp_enabled: boolean;
  check_count: number;
  alert_channel_count: number;
  last_ping_at: number | null;
}

export async function listUsersForAdmin(env: Env): Promise<AdminUserSummary[]> {
  const { results } = await env.DB.prepare(
    `SELECT
       users.id AS id,
       users.email AS email,
       users.created_at AS created_at,
       (users.email_verified_at IS NOT NULL) AS email_verified,
       (users.totp_secret IS NOT NULL) AS totp_enabled,
       (SELECT COUNT(*) FROM checks WHERE checks.user_id = users.id) AS check_count,
       (SELECT COUNT(*) FROM alert_channels WHERE alert_channels.user_id = users.id) AS alert_channel_count,
       (SELECT MAX(pings.created_at) FROM pings
          JOIN checks ON checks.id = pings.check_id
         WHERE checks.user_id = users.id) AS last_ping_at
     FROM users
     ORDER BY users.created_at DESC`,
  ).all<{
    id: string;
    email: string;
    created_at: number;
    email_verified: 0 | 1;
    totp_enabled: 0 | 1;
    check_count: number;
    alert_channel_count: number;
    last_ping_at: number | null;
  }>();
  return results.map((row) => ({
    ...row,
    email_verified: row.email_verified === 1,
    totp_enabled: row.totp_enabled === 1,
  }));
}

// --- Archive integrity monitor (bit-rot detection) -------------------------
// See migrations/0009_archive_manifests.sql and src/archive.ts.

// Bounds a single sync request's D1 batch size and Worker CPU time — see
// migrations/0009's comment. A real limitation for very large archives
// (500k+ files), documented rather than silently truncated: the endpoint
// below rejects an oversized sync outright with a clear error instead of
// quietly dropping files past this count.
export const MAX_ARCHIVE_FILES_PER_SYNC = 20000;

// D1 batch() calls are chunked at this size to stay well under D1's
// per-batch statement ceiling rather than sending one gigantic batch.
const ARCHIVE_BATCH_CHUNK_SIZE = 100;

async function getArchiveFilesForCheck(env: Env, checkId: string): Promise<Map<string, StoredArchiveFile>> {
  const { results } = await env.DB.prepare(
    "SELECT path, size, hash, mtime FROM archive_files WHERE check_id = ?",
  )
    .bind(checkId)
    .all<{ path: string; size: number; hash: string; mtime: number }>();
  return new Map(results.map((r) => [r.path, { size: r.size, hash: r.hash, mtime: r.mtime }]));
}

export interface FlaggedArchiveFile {
  path: string;
  size: number;
  hash: string;
  mtime: number;
  flagged_at: number;
  flagged_reason: string;
}

/** Just the files currently flagged as suspected bit-rot for one check —
 * powers the dashboard's archive detail view. Ordered most-recently-flagged
 * first so a fresh corruption event surfaces at the top. */
export async function getFlaggedArchiveFiles(env: Env, checkId: string): Promise<FlaggedArchiveFile[]> {
  const { results } = await env.DB.prepare(
    `SELECT path, size, hash, mtime, flagged_at, flagged_reason FROM archive_files
     WHERE check_id = ? AND flagged_at IS NOT NULL ORDER BY flagged_at DESC`,
  )
    .bind(checkId)
    .all<FlaggedArchiveFile>();
  return results;
}

export interface ArchiveSyncResult {
  newCount: number;
  unchangedCount: number;
  legitimateEditCount: number;
  flaggedCount: number;
  removedCount: number;
}

/**
 * Diffs an incoming full manifest against what this check already has on
 * record, applies the per-file verdict from evaluateArchiveFile() to each,
 * and updates `checks.flagged_archive_file_count` to match afterward —
 * the full manifest is sent every sync (see agent/vestal-archive.sh's
 * comment for why) so the diffing happens here, not client-side.
 */
export async function syncArchiveManifest(
  env: Env,
  checkId: string,
  incoming: ArchiveFileRecord[],
): Promise<ArchiveSyncResult> {
  const existing = await getArchiveFilesForCheck(env, checkId);
  const now = nowSeconds();
  const incomingPaths = new Set(incoming.map((f) => f.path));

  const statements: D1PreparedStatement[] = [];
  let newCount = 0;
  let unchangedCount = 0;
  let legitimateEditCount = 0;
  let flaggedCount = 0;

  for (const file of incoming) {
    const existingRow = existing.get(file.path) ?? null;
    const verdict = evaluateArchiveFile(file, existingRow);
    switch (verdict.kind) {
      case "new":
        newCount++;
        statements.push(
          env.DB.prepare(
            `INSERT INTO archive_files (check_id, path, size, hash, mtime, first_seen_at, last_seen_at, flagged_at, flagged_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL)`,
          ).bind(checkId, file.path, file.size, file.hash, file.mtime, now, now),
        );
        break;
      case "unchanged":
        unchangedCount++;
        statements.push(
          env.DB.prepare("UPDATE archive_files SET last_seen_at = ? WHERE check_id = ? AND path = ?").bind(
            now,
            checkId,
            file.path,
          ),
        );
        break;
      case "legitimate_edit":
        legitimateEditCount++;
        statements.push(
          env.DB.prepare(
            `UPDATE archive_files SET size = ?, hash = ?, mtime = ?, last_seen_at = ?, flagged_at = NULL, flagged_reason = NULL
             WHERE check_id = ? AND path = ?`,
          ).bind(file.size, file.hash, file.mtime, now, checkId, file.path),
        );
        break;
      case "suspected_corruption":
        flaggedCount++;
        statements.push(
          env.DB.prepare(
            `UPDATE archive_files SET hash = ?, last_seen_at = ?, flagged_at = ?, flagged_reason = ?
             WHERE check_id = ? AND path = ?`,
          ).bind(file.hash, now, now, verdict.reason, checkId, file.path),
        );
        break;
    }
  }

  // A file no longer in the walked directory (renamed, moved, deleted) —
  // the manifest tracks current disk state, not permanent history, so
  // it's removed rather than flagged: a missing file isn't bit rot, it's
  // just... missing, and the pass/fail ping already covers "something
  // about this check needs attention" if that matters to the user.
  const removedPaths = [...existing.keys()].filter((p) => !incomingPaths.has(p));
  for (const path of removedPaths) {
    statements.push(
      env.DB.prepare("DELETE FROM archive_files WHERE check_id = ? AND path = ?").bind(checkId, path),
    );
  }

  for (let i = 0; i < statements.length; i += ARCHIVE_BATCH_CHUNK_SIZE) {
    await env.DB.batch(statements.slice(i, i + ARCHIVE_BATCH_CHUNK_SIZE));
  }

  const flaggedTotal = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM archive_files WHERE check_id = ? AND flagged_at IS NOT NULL",
  )
    .bind(checkId)
    .first<{ n: number }>();
  await env.DB.prepare("UPDATE checks SET flagged_archive_file_count = ? WHERE id = ?")
    .bind(flaggedTotal?.n ?? 0, checkId)
    .run();

  return { newCount, unchangedCount, legitimateEditCount, flaggedCount, removedCount: removedPaths.length };
}

// --- Backup config & retention policy auditor -------------------------
// See migrations/0010_config_audit.sql and src/audit-rules.ts.

/** Replaces a check's entire findings set with the latest report — a
 * finding from an old policy that's since been fixed shouldn't linger
 * (see migrations/0010's comment for why this isn't an append-only log). */
export async function replaceConfigAuditFindings(
  env: Env,
  checkId: string,
  findings: AuditFinding[],
): Promise<void> {
  const now = nowSeconds();
  const warningCount = findings.filter((f) => f.severity === "warning").length;
  const statements = [
    env.DB.prepare("DELETE FROM config_audit_findings WHERE check_id = ?").bind(checkId),
    ...findings.map((f) =>
      env.DB.prepare(
        "INSERT INTO config_audit_findings (check_id, finding_id, severity, message, created_at) VALUES (?, ?, ?, ?, ?)",
      ).bind(checkId, f.id, f.severity, f.message, now),
    ),
    env.DB.prepare("UPDATE checks SET config_audit_warning_count = ? WHERE id = ?").bind(warningCount, checkId),
  ];
  await env.DB.batch(statements);
}

export async function getConfigAuditFindings(
  env: Env,
  checkId: string,
): Promise<Array<{ finding_id: string; severity: string; message: string }>> {
  const { results } = await env.DB.prepare(
    "SELECT finding_id, severity, message FROM config_audit_findings WHERE check_id = ? ORDER BY severity, finding_id",
  )
    .bind(checkId)
    .all<{ finding_id: string; severity: string; message: string }>();
  return results;
}

// --- Automated restore drills with real RTO reporting ------------------
// See migrations/0013_restore_drills.sql and PRO_FEATURES_ROADMAP.md item 5.

/** Appends one drill run (append-only, unlike config-audit findings — see
 * the migration's comment for why this needs to be a real history, not a
 * replaced-in-place latest state) and updates the check's denormalized
 * last-drill fields so the dashboard can show status without a second
 * query per check card. */
export async function recordDrillRun(
  env: Env,
  checkId: string,
  run: {
    status: "pass" | "fail";
    durationMs: number;
    filesRestored: number | null;
    filesExpected: number | null;
    message: string | null;
  },
): Promise<void> {
  const now = nowSeconds();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO drill_runs (id, check_id, status, duration_ms, files_restored, files_expected, message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(uuid(), checkId, run.status, run.durationMs, run.filesRestored, run.filesExpected, run.message, now),
    // last_drill_reminder_at is cleared here too — a fresh drill (pass or
    // fail) re-arms the overdue-drill reminder for the NEXT time this
    // check's cadence lapses, same as recordPing() clearing
    // last_alerted_at on every new ping so the overdue-check sweep can
    // fire again for a future lapse instead of staying silenced forever.
    env.DB.prepare(
      `UPDATE checks SET last_drill_at = ?, last_drill_status = ?, last_drill_duration_ms = ?, last_drill_reminder_at = NULL WHERE id = ?`,
    ).bind(now, run.status, run.durationMs, checkId),
  ]);
}

// Enough runs to draw a meaningful RTO trend without the dashboard detail
// panel pulling unbounded history — drills run far less often than normal
// verification pings (weekly/monthly, not every few minutes), so this
// still covers well over a year of history at any realistic cadence.
const DRILL_RUN_HISTORY_LIMIT = 50;

export async function getRecentDrillRuns(env: Env, checkId: string): Promise<DrillRunRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT id, check_id, status, duration_ms, files_restored, files_expected, message, created_at
       FROM drill_runs WHERE check_id = ? ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(checkId, DRILL_RUN_HISTORY_LIMIT)
    .all<DrillRunRow>();
  return results;
}

/** Sets (or clears, with null) a check's drill-reminder cadence — see
 * migrations/0015_drill_scheduling.sql for why this is a reminder, not an
 * actual remote trigger. Scoped to the owning user, same convention as
 * deleteCheck. Returns false if no matching check was found. */
export async function setDrillSchedule(
  env: Env,
  checkId: string,
  userId: string,
  drillIntervalSeconds: number | null,
): Promise<boolean> {
  const { meta } = await env.DB.prepare(
    "UPDATE checks SET drill_interval_seconds = ? WHERE id = ? AND user_id = ?",
  )
    .bind(drillIntervalSeconds, checkId, userId)
    .run();
  return meta.changes > 0;
}

/**
 * Every check with a configured drill cadence that's gone quiet past it —
 * `last_drill_reminder_at IS NULL` is the same "haven't already alerted on
 * THIS overdue period" gate findOverdueChecks() uses via last_alerted_at.
 * Fires once per lapse; recordDrillRun() clears last_drill_reminder_at back
 * to NULL on the next real drill, re-arming this for the check's NEXT
 * lapse rather than leaving it permanently silenced.
 */
export async function findOverdueDrillChecks(env: Env): Promise<CheckRow[]> {
  const now = nowSeconds();
  const { results } = await env.DB.prepare(
    `SELECT * FROM checks
      WHERE drill_interval_seconds IS NOT NULL
        AND last_drill_reminder_at IS NULL
        AND (
          (last_drill_at IS NULL AND ? - created_at > drill_interval_seconds)
          OR
          (last_drill_at IS NOT NULL AND ? - last_drill_at > drill_interval_seconds)
        )`,
  )
    .bind(now, now)
    .all<CheckRow>();
  return results;
}

export async function markDrillReminded(env: Env, checkId: string): Promise<void> {
  await env.DB.prepare("UPDATE checks SET last_drill_reminder_at = ? WHERE id = ?")
    .bind(nowSeconds(), checkId)
    .run();
}

// --- Insurer-grade verification ledger --------------------------------
// See migrations/0011_verification_ledger.sql and src/ledger.ts.

export interface LedgerEntryRow {
  id: string;
  user_id: string;
  check_id: string;
  check_name: string;
  backend: string;
  status: "pass" | "fail";
  message: string | null;
  prev_hash: string | null;
  entry_hash: string;
  signature: string;
  created_at: number;
}

/** Null for a user's very first ledger entry. This and appendLedgerEntry
 * below are still two separate D1 calls, not one atomic transaction — on
 * their own, two pings for the SAME user landing in the same instant
 * could read the same "last hash" and fork the chain. That race is closed
 * at the call site, not here: callers must not call these two functions
 * directly from a Worker request handler. Instead, both go through
 * `LedgerCoordinator` (src/ledger-coordinator.ts), a Durable Object with
 * one instance per user, which serializes every user's read-then-append
 * sequence via an instance-local queue — see that file's comment for why
 * routing to one DO instance alone isn't sufficient by itself. Verified
 * fork-free under real concurrent load 2026-07-24 (see
 * PRO_FEATURES_ROADMAP.md item 4). */
export async function getLastLedgerHash(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    "SELECT entry_hash FROM ledger_entries WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
  )
    .bind(userId)
    .first<{ entry_hash: string }>();
  return row?.entry_hash ?? null;
}

export async function appendLedgerEntry(env: Env, entry: LedgerEntryRow): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ledger_entries
      (id, user_id, check_id, check_name, backend, status, message, prev_hash, entry_hash, signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      entry.id,
      entry.user_id,
      entry.check_id,
      entry.check_name,
      entry.backend,
      entry.status,
      entry.message,
      entry.prev_hash,
      entry.entry_hash,
      entry.signature,
      entry.created_at,
    )
    .run();
}

export async function listLedgerEntriesForUser(env: Env, userId: string): Promise<LedgerEntryRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM ledger_entries WHERE user_id = ? ORDER BY created_at ASC, rowid ASC",
  )
    .bind(userId)
    .all<LedgerEntryRow>();
  return results;
}

// --- Billing (Paddle) --------------------------------------------------
// See migrations/0012_billing.sql and src/billing.ts.

export async function getUserByPaddleCustomerId(env: Env, paddleCustomerId: string): Promise<UserRow | null> {
  return env.DB.prepare("SELECT * FROM users WHERE paddle_customer_id = ?")
    .bind(paddleCustomerId)
    .first<UserRow>();
}

/**
 * Applies a plan update to a specific user (already resolved — either by
 * custom_data.user_id on first link, or by paddle_customer_id on every
 * event after that). Idempotent: replaying the same webhook (Paddle does
 * retry on a non-2xx response) just writes the same state again.
 */
export async function setUserPlan(
  env: Env,
  userId: string,
  update: { plan: string; paddleCustomerId: string; paddleSubscriptionId: string },
): Promise<void> {
  await env.DB.prepare(
    `UPDATE users
        SET plan = ?, paddle_customer_id = ?, paddle_subscription_id = ?, plan_updated_at = ?
      WHERE id = ?`,
  )
    .bind(update.plan, update.paddleCustomerId, update.paddleSubscriptionId, nowSeconds(), userId)
    .run();
}

// --- MSP / Team tier --------------------------------------------------
// See migrations/0014_organizations.sql and PRO_FEATURES_ROADMAP.md item 6.

export async function createOrganization(env: Env, ownerUserId: string, name: string): Promise<OrganizationRow> {
  const row: OrganizationRow = { id: uuid(), name, owner_user_id: ownerUserId, created_at: nowSeconds() };
  // The owner's own membership row is created in the same batch as the
  // organization itself — there is no valid state where an org exists but
  // its owner isn't a member of it (see migrations/0014's comment on why
  // membership is a single table covering owner + everyone else).
  await env.DB.batch([
    env.DB.prepare("INSERT INTO organizations (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)").bind(
      row.id,
      row.name,
      row.owner_user_id,
      row.created_at,
    ),
    env.DB.prepare(
      "INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ).bind(row.id, ownerUserId, row.created_at),
  ]);
  return row;
}

export async function getOrganizationById(env: Env, id: string): Promise<OrganizationRow | null> {
  return env.DB.prepare("SELECT * FROM organizations WHERE id = ?").bind(id).first<OrganizationRow>();
}

export interface OrganizationWithRole extends OrganizationRow {
  role: OrganizationRole;
}

export async function listOrganizationsForUser(env: Env, userId: string): Promise<OrganizationWithRole[]> {
  const { results } = await env.DB.prepare(
    `SELECT organizations.*, organization_members.role AS role
       FROM organizations
       JOIN organization_members ON organization_members.organization_id = organizations.id
      WHERE organization_members.user_id = ?
      ORDER BY organizations.created_at DESC`,
  )
    .bind(userId)
    .all<OrganizationWithRole>();
  return results;
}

/** Null if this user isn't a member of this org at all — callers use this
 * both to gate access and to tell owner from member. */
export async function getOrganizationMembership(
  env: Env,
  organizationId: string,
  userId: string,
): Promise<OrganizationMemberRow | null> {
  return env.DB.prepare(
    "SELECT * FROM organization_members WHERE organization_id = ? AND user_id = ?",
  )
    .bind(organizationId, userId)
    .first<OrganizationMemberRow>();
}

export interface OrganizationMemberWithEmail {
  user_id: string;
  email: string;
  role: OrganizationRole;
  created_at: number;
}

export async function listOrganizationMembers(env: Env, organizationId: string): Promise<OrganizationMemberWithEmail[]> {
  const { results } = await env.DB.prepare(
    `SELECT organization_members.user_id AS user_id, users.email AS email,
            organization_members.role AS role, organization_members.created_at AS created_at
       FROM organization_members
       JOIN users ON users.id = organization_members.user_id
      WHERE organization_members.organization_id = ?
      ORDER BY organization_members.created_at ASC`,
  )
    .bind(organizationId)
    .all<OrganizationMemberWithEmail>();
  return results;
}

/** Adds an EXISTING Vestal user (looked up by email) as a member —
 * deliberately not an email-invite flow for non-users yet, see
 * migrations/0014's comment for why that's a real, separate next step.
 * An UPSERT, not a plain INSERT: re-"adding" someone who's already a
 * member updates their role instead of erroring, which doubles as the
 * only way to promote a member to owner (or demote an owner to member)
 * without a separate dedicated endpoint. */
export async function addOrganizationMember(
  env: Env,
  organizationId: string,
  userId: string,
  role: OrganizationRole,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = excluded.role`,
  )
    .bind(organizationId, userId, role, nowSeconds())
    .run();
}

export async function removeOrganizationMember(env: Env, organizationId: string, userId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM organization_members WHERE organization_id = ? AND user_id = ?")
    .bind(organizationId, userId)
    .run();
}

export async function countOrganizationOwners(env: Env, organizationId: string): Promise<number> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM organization_members WHERE organization_id = ? AND role = 'owner'",
  )
    .bind(organizationId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createClient(env: Env, organizationId: string, name: string): Promise<ClientRow> {
  const row: ClientRow = { id: uuid(), organization_id: organizationId, name, created_at: nowSeconds() };
  await env.DB.prepare("INSERT INTO clients (id, organization_id, name, created_at) VALUES (?, ?, ?, ?)")
    .bind(row.id, row.organization_id, row.name, row.created_at)
    .run();
  return row;
}

export async function getClientById(env: Env, clientId: string): Promise<ClientRow | null> {
  return env.DB.prepare("SELECT * FROM clients WHERE id = ?").bind(clientId).first<ClientRow>();
}

export async function listClientsForOrganization(env: Env, organizationId: string): Promise<ClientRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM clients WHERE organization_id = ? ORDER BY name ASC",
  )
    .bind(organizationId)
    .all<ClientRow>();
  return results;
}

/** Deletes a client and un-tags (not deletes) every check that was
 * assigned to it — a client is a grouping label, and losing the label
 * shouldn't take a real check's history down with it. Done as an explicit
 * UPDATE rather than relying on the schema's `ON DELETE SET NULL` (same
 * reasoning as deleteUser()'s comment: D1's PRAGMA foreign_keys state
 * isn't something to depend on). */
export async function deleteClient(env: Env, clientId: string, organizationId: string): Promise<boolean> {
  await env.DB.prepare("UPDATE checks SET client_id = NULL WHERE client_id = ? AND organization_id = ?")
    .bind(clientId, organizationId)
    .run();
  const { meta } = await env.DB.prepare("DELETE FROM clients WHERE id = ? AND organization_id = ?")
    .bind(clientId, organizationId)
    .run();
  return meta.changes > 0;
}

/** Invite-by-email for someone WITHOUT a Vestal account yet — see
 * migrations/0016_organization_invites.sql. Doesn't check for an existing
 * pending invite to the same email first (a re-invite just creates another
 * row); consumeOrganizationInvitesForEmail() below accepts every unexpired,
 * unaccepted invite for an email at once, so duplicates are harmless, just
 * slightly wasteful — not worth a second query to prevent. */
export async function createOrganizationInvite(
  env: Env,
  organizationId: string,
  email: string,
  role: OrganizationRole,
  invitedByUserId: string,
): Promise<OrganizationInviteRow> {
  const now = nowSeconds();
  const row: OrganizationInviteRow = {
    id: resetToken(), // same random-token shape as a password reset token
    organization_id: organizationId,
    email: email.toLowerCase(),
    role,
    invited_by_user_id: invitedByUserId,
    created_at: now,
    expires_at: now + ORGANIZATION_INVITE_LIFETIME_SECONDS,
    accepted_at: null,
  };
  await env.DB.prepare(
    `INSERT INTO organization_invites
      (id, organization_id, email, role, invited_by_user_id, created_at, expires_at, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(row.id, row.organization_id, row.email, row.role, row.invited_by_user_id, row.created_at, row.expires_at, row.accepted_at)
    .run();
  return row;
}

export async function listPendingInvitesForOrganization(env: Env, organizationId: string): Promise<OrganizationInviteRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM organization_invites
      WHERE organization_id = ? AND accepted_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
  )
    .bind(organizationId, nowSeconds())
    .all<OrganizationInviteRow>();
  return results;
}

export async function revokeOrganizationInvite(env: Env, inviteId: string, organizationId: string): Promise<boolean> {
  const { meta } = await env.DB.prepare(
    "DELETE FROM organization_invites WHERE id = ? AND organization_id = ?",
  )
    .bind(inviteId, organizationId)
    .run();
  return meta.changes > 0;
}

/**
 * Called at signup (see POST /api/auth/signup in src/index.ts) — accepts
 * every unexpired, unaccepted invite for this email at once (a person can
 * reasonably be invited to more than one organization before ever signing
 * up) and adds the new user as a member of each. Marks each invite
 * accepted rather than deleting it, so "who invited this account and
 * when" stays visible in history.
 */
export async function consumeOrganizationInvitesForEmail(env: Env, email: string, userId: string): Promise<number> {
  const now = nowSeconds();
  const { results } = await env.DB.prepare(
    "SELECT * FROM organization_invites WHERE email = ? AND accepted_at IS NULL AND expires_at > ?",
  )
    .bind(email.toLowerCase(), now)
    .all<OrganizationInviteRow>();

  if (results.length === 0) return 0;

  const statements: D1PreparedStatement[] = [];
  for (const invite of results) {
    statements.push(
      env.DB.prepare("UPDATE organization_invites SET accepted_at = ? WHERE id = ?").bind(now, invite.id),
    );
    statements.push(
      env.DB.prepare(
        `INSERT INTO organization_members (organization_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (organization_id, user_id) DO UPDATE SET role = excluded.role`,
      ).bind(invite.organization_id, userId, invite.role, now),
    );
  }
  await env.DB.batch(statements);
  return results.length;
}

/** Every check belonging to an organization, regardless of which member
 * created it — the actual "team" behavior this whole feature exists for.
 * Kept as its own dedicated dashboard section/endpoint rather than merged
 * into GET /api/checks, so an existing personal account's check list stays
 * exactly as it always has been for anyone not using Organizations. */
export async function listChecksForOrganization(env: Env, organizationId: string): Promise<CheckRow[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM checks WHERE organization_id = ? ORDER BY created_at DESC",
  )
    .bind(organizationId)
    .all<CheckRow>();
  return results;
}

/** Moves a check to a different client within the SAME organization it
 * already belongs to (or unassigns it with clientId = null) — scoped by
 * organization_id so a member of one org can't relabel a check that
 * belongs to another. Returns false if the check isn't in this org. */
export async function setCheckClient(
  env: Env,
  checkId: string,
  organizationId: string,
  clientId: string | null,
): Promise<boolean> {
  const { meta } = await env.DB.prepare(
    "UPDATE checks SET client_id = ? WHERE id = ? AND organization_id = ?",
  )
    .bind(clientId, checkId, organizationId)
    .run();
  return meta.changes > 0;
}
