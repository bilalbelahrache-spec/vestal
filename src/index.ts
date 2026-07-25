import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  addOrganizationMember,
  clearAnomaly,
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  consumeRecoveryCode,
  countAlertChannelsForUser,
  countChecksForUser,
  countOrganizationOwners,
  createAlertChannel,
  createCheck,
  consumeOrganizationInvitesForEmail,
  createClient,
  createEmailVerificationToken,
  createOrganization,
  createOrganizationInvite,
  createPasswordResetToken,
  createPending2faLogin,
  createSession,
  createUser,
  deleteAlertChannel,
  deleteAllSessionsForUser,
  deleteCheck,
  deleteClient,
  deletePending2faLogin,
  deleteSession,
  deleteUser,
  disableTotp,
  enableTotp,
  findOverdueChecks,
  findOverdueDrillChecks,
  getCheckByPingToken,
  getCheckById,
  getClientById,
  getConfigAuditFindings,
  getFlaggedArchiveFiles,
  getOrganizationById,
  getOrganizationMembership,
  getRecentDiffStats,
  getRecentDrillRuns,
  getUserByApiKey,
  getUserByEmail,
  getUserById,
  getUserByPaddleCustomerId,
  getUserBySessionToken,
  getValidEmailVerificationToken,
  getValidPasswordResetToken,
  getValidPending2faLogin,
  listAlertChannelsForUser,
  listChecksForOrganization,
  listChecksForUser,
  listClientsForOrganization,
  listLedgerEntriesForUser,
  listOrganizationMembers,
  listOrganizationsForUser,
  listPendingInvitesForOrganization,
  listPingsForUser,
  listUsersForAdmin,
  markAlerted,
  markAnomaly,
  markDrillReminded,
  markEmailVerified,
  MAX_ARCHIVE_FILES_PER_SYNC,
  recordDiffStats,
  recordDrillRun,
  recordPing,
  regenerateApiKey,
  removeOrganizationMember,
  revokeOrganizationInvite,
  replaceConfigAuditFindings,
  replaceRecoveryCodes,
  setCheckClient,
  setDrillSchedule,
  setPendingTotpSecret,
  setUserPlan,
  syncArchiveManifest,
  updateUserPassword,
} from "./db";
import { dispatchAlert } from "./alerts";
import { renderCheckBadge, renderUnknownBadge } from "./badge";
import type { ArchiveFileRecord } from "./archive";
import { scoreAnomaly } from "./anomaly";
import { auditDuplicatiRetention, auditKopiaPolicy, auditRetentionFlags, type KopiaPolicySnapshot } from "./audit-rules";
import {
  derivePlanUpdate,
  isProUser,
  isTeamUser,
  type PaddleSubscriptionEventData,
  paddleApiBaseUrl,
  PRO_UPGRADE_MESSAGE,
  verifyPaddleWebhookSignature,
} from "./billing";
import { sendEmail } from "./email";
import { type EmailContent, renderEmailHtml, renderEmailText } from "./email-template";
import { importSigningPublicKey, verifyLedgerChain } from "./ledger";
import type { AppendLedgerEntryInput } from "./ledger-coordinator";
// Durable Object classes referenced in wrangler.jsonc's `durable_objects`
// binding must be exported from the Worker's entrypoint module (this
// file, per wrangler.jsonc's `main`) — wrangler dev/deploy errors at
// startup otherwise ("depends on ... which are not exported").
export { LedgerCoordinator } from "./ledger-coordinator";
import { checkRateLimit, clientIp, pruneRateLimits } from "./ratelimit";
import { securityHeaders } from "./security";
import { verifyTurnstileToken } from "./turnstile";
import type { CheckStatus, DiffStatSample, Env, PingStatus, UserRow } from "./types";
import {
  apiKey as generateApiKey,
  generateRecoveryCode,
  generateTotpSecret,
  hashPassword,
  isSafeWebhookUrl,
  nowSeconds,
  timingSafeEqualStrings,
  totpAuthUrl,
  verifyPassword,
  verifyTotpCode,
} from "./util";

const app = new Hono<{ Bindings: Env }>();
app.use("*", securityHeaders());

const SESSION_COOKIE = "vestal_session";
const SESSION_COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days, matches db.ts's session lifetime

function setSessionCookie(c: any, token: string) {
  // `secure: true` unconditionally would silently break local `wrangler dev`
  // (plain http://127.0.0.1) — real browsers refuse to store a Secure
  // cookie over a non-TLS origin at all, unlike curl, which doesn't
  // enforce that and would mask the bug. Deriving it from the actual
  // request scheme means it's correctly secure in production without
  // needing separate dev/prod config.
  const isHttps = new URL(c.req.url).protocol === "https:";
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

function tooManyRequests(c: any, retryAfterSeconds: number) {
  c.header("Retry-After", String(Math.max(1, retryAfterSeconds)));
  return c.json({ error: "too many requests — try again shortly" }, 429);
}

/** Best-effort: a failed send here shouldn't fail signup/resend itself —
 * same convention as the forgot-password email (see that handler). */
async function sendVerificationEmail(c: any, user: UserRow): Promise<void> {
  const token = await createEmailVerificationToken(c.env, user.id);
  const url = new URL(c.req.url);
  const verifyLink = `${url.origin}/verify-email?token=${token.id}`;
  const content: EmailContent = {
    heading: "Verify your email address",
    paragraphs: ["Welcome to Vestal. Confirm this is your email address to finish setting up your account."],
    cta: { label: "Verify email address", url: verifyLink },
    footerNote:
      "This link expires in 24 hours. Your account already works without this step — it just " +
      "confirms alerts and account emails are reaching the right inbox.",
  };
  const sent = await sendEmail(
    c.env,
    user.email,
    "Verify your Vestal email address",
    renderEmailText(content),
    renderEmailHtml(url.origin, content),
  );
  if (!sent) {
    console.warn(`verification email could not be sent to user ${user.id}`);
  }
}

app.get("/", (c) => c.text("Vestal — see /README for what this is."));

// A monitoring product that nobody monitors is a real gap, not a
// hypothetical one — this endpoint exists so an external uptime checker
// (UptimeRobot, Healthchecks.io, anything) can be pointed at it. Wiring
// one up is a you-specific step (needs a third-party account), but the
// endpoint itself doesn't need to wait on that.
app.get("/health", async (c) => {
  try {
    await c.env.DB.prepare("SELECT 1").first();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : "unknown error" }, 500);
  }
});

// --- Ping ingestion -------------------------------------------------------
// GET or POST both accepted: cron jobs commonly use `curl` with no body,
// which is a GET by default, so we don't force POST-only like some
// similar services do.

async function handlePing(
  c: any,
  status: PingStatus,
): Promise<Response> {
  const token = c.req.param("token");
  const check = await getCheckByPingToken(c.env, token);
  if (!check) return c.text("unknown ping token", 404);

  // Ping tokens are 32 random bytes — not brute-forceable — so this isn't
  // guarding against guessing, it's a sanity cap against a runaway or
  // misconfigured client hammering the endpoint in a loop.
  const limit = await checkRateLimit(c.env, `ping:${token}`, 30, 60);
  if (!limit.allowed) return c.text("too many requests", 429);

  // Agents already self-limit to ~500 bytes of log tail (see agent/*.sh),
  // so 4096 chars leaves generous headroom for real use while capping the
  // storage cost of someone hammering a valid ping token with an oversized
  // payload (the 30/min rate limit above bounds request *count*, not size).
  const MAX_MESSAGE_LENGTH = 4096;
  const rawMessage = c.req.query("message") ?? null;
  const message = rawMessage !== null ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : null;
  const durationRaw = c.req.query("duration_ms");
  const durationMs = durationRaw ? Number(durationRaw) : null;

  await recordPing(c.env, check, status, message, durationMs);

  // Anomaly scoring and the verification ledger are Pro-only (see
  // src/billing.ts) — the core pass/fail ping above already succeeded and
  // is never gated, only these two extras are. One lookup covers both
  // rather than each helper re-fetching the same user.
  const owner = await getUserById(c.env, check.user_id);
  if (isProUser(owner)) {
    await maybeScoreAnomaly(c, check);
    if (status !== "start") await maybeAppendLedgerEntry(c.env, check, status, message);
  }
  return c.text("ok");
}

/**
 * Insurer-grade verification ledger — see src/ledger.ts,
 * src/ledger-coordinator.ts, and migrations/0011. Optional, same
 * convention as email/Turnstile: if LEDGER_SIGNING_PRIVATE_KEY isn't
 * configured (local dev without it set up), this just no-ops rather than
 * failing the ping. "start" pings are excluded — they're not a completed
 * verification, nothing to attest to yet.
 *
 * The actual read-last-hash/sign/append sequence now happens inside the
 * per-user LedgerCoordinator Durable Object (routed via
 * idFromName(check.user_id)), not here — that's what serializes two
 * concurrent pings for the same user instead of letting them both read
 * the same "last hash" and fork the chain. See src/ledger-coordinator.ts's
 * file comment for exactly why routing to one DO instance alone isn't
 * sufficient and what closes the race.
 */
async function maybeAppendLedgerEntry(
  env: Env,
  check: NonNullable<Awaited<ReturnType<typeof getCheckByPingToken>>>,
  status: "pass" | "fail",
  message: string | null,
): Promise<void> {
  if (!env.LEDGER_SIGNING_PRIVATE_KEY) return;

  const input: AppendLedgerEntryInput = {
    userId: check.user_id,
    checkId: check.id,
    checkName: check.name,
    backend: check.backend,
    status,
    message,
  };
  const id = env.LEDGER_COORDINATOR.idFromName(check.user_id);
  const stub = env.LEDGER_COORDINATOR.get(id);
  await stub.appendLedgerEntry(input);
}

/**
 * Ransomware/anomaly canary — see src/anomaly.ts and migrations/0008.
 * Entirely optional: `files_changed` absent means this agent doesn't
 * report diff stats (an older agent version, or a backend this hasn't
 * been wired up for yet), which is treated as "nothing to score," not
 * "zero change." Best-effort by design, same as the rest of ping
 * handling — a bug here must never break the core pass/fail path above,
 * which has already succeeded by the time this runs.
 */
async function maybeScoreAnomaly(c: any, check: Awaited<ReturnType<typeof getCheckByPingToken>>): Promise<void> {
  if (!check) return;
  const diffStats = parseDiffStats(c);
  if (!diffStats) return;

  const history = await getRecentDiffStats(c.env, check.id, 60);
  const { score, isAnomalous } = scoreAnomaly(history, diffStats);
  await recordDiffStats(c.env, check.id, diffStats, score);
  if (score === null) return; // not enough baseline history to say anything either way yet

  if (!isAnomalous) {
    if (check.last_anomaly_at !== null) await clearAnomaly(c.env, check.id);
    return;
  }

  await markAnomaly(c.env, check.id, score);
  const channels = await listAlertChannelsForUser(c.env, check.user_id);
  for (const channel of channels) {
    await dispatchAlert(c.env, channel, {
      check,
      reason: "anomaly",
      detail:
        `This run changed far more than usual for this check (unusualness score ${score.toFixed(1)}, ` +
        `flagged past a threshold of 3). This can mean ransomware or another mass-corruption event, but ` +
        `can also be a legitimate large change (a reorganize, a migration) — verify before assuming the worst.`,
    });
  }
}

function parseDiffStats(c: any): DiffStatSample | null {
  const rawChanged = c.req.query("files_changed");
  if (rawChanged === undefined) return null; // this agent doesn't report diff stats — skip, don't treat as zero

  const sample: DiffStatSample = {
    files_changed: Number(rawChanged),
    files_added: Number(c.req.query("files_added") ?? 0),
    files_removed: Number(c.req.query("files_removed") ?? 0),
    ext_change_count: Number(c.req.query("ext_change_count") ?? 0),
  };
  const values = [sample.files_changed, sample.files_added, sample.files_removed, sample.ext_change_count];
  if (values.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return sample;
}

app.get("/ping/:token", (c) => handlePing(c, "pass"));
app.post("/ping/:token", (c) => handlePing(c, "pass"));
app.get("/ping/:token/fail", (c) => handlePing(c, "fail"));
app.post("/ping/:token/fail", (c) => handlePing(c, "fail"));
app.get("/ping/:token/start", (c) => handlePing(c, "start"));
app.post("/ping/:token/start", (c) => handlePing(c, "start"));

// --- Archive integrity monitor (bit-rot detection) — see src/archive.ts,
// migrations/0009, and agent/vestal-archive.sh. A different shape than the
// pass/fail ping above: the agent sends its FULL current manifest as a
// JSON body every sync (not query-string fields), since a real archive can
// be tens of thousands of files — this needed a real endpoint, not
// something that fits in a URL.
app.post("/ping/:token/archive-sync", async (c) => {
  const token = c.req.param("token");
  const check = await getCheckByPingToken(c.env, token);
  if (!check) return c.text("unknown ping token", 404);
  if (check.backend !== "archive") {
    return c.json({ error: "this check's backend isn't 'archive' — archive-sync only applies to archive checks" }, 400);
  }
  const owner = await getUserById(c.env, check.user_id);
  if (!isProUser(owner)) return c.json({ error: PRO_UPGRADE_MESSAGE }, 402);

  // A sync can be a genuinely large request (a full manifest) — a much
  // lower per-hour ceiling than the 30/min pass/fail ping limit, since
  // this is meant to run on a slow schedule (weekly/monthly), not
  // repeatedly, and each one does real batched D1 writes.
  const limit = await checkRateLimit(c.env, `archive-sync:${token}`, 10, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  const body = await c.req.json<{ files?: unknown }>().catch(() => ({}) as { files?: unknown });
  if (!Array.isArray(body.files)) {
    return c.json({ error: "files must be an array of {path, size, hash, mtime}" }, 400);
  }
  if (body.files.length > MAX_ARCHIVE_FILES_PER_SYNC) {
    return c.json(
      { error: `at most ${MAX_ARCHIVE_FILES_PER_SYNC} files per sync — this archive is larger than the current limit` },
      400,
    );
  }
  const files: ArchiveFileRecord[] = [];
  for (const f of body.files) {
    if (
      typeof f !== "object" ||
      f === null ||
      typeof (f as any).path !== "string" ||
      !(f as any).path ||
      typeof (f as any).size !== "number" ||
      typeof (f as any).hash !== "string" ||
      !(f as any).hash ||
      typeof (f as any).mtime !== "number"
    ) {
      return c.json({ error: "each file needs a non-empty path, a numeric size, a non-empty hash, and a numeric mtime" }, 400);
    }
    files.push(f as ArchiveFileRecord);
  }

  const result = await syncArchiveManifest(c.env, check.id, files);
  const archiveStatus = result.flaggedCount > 0 ? "fail" : "pass";
  const archiveMessage =
    `archive sync: ${result.newCount} new, ${result.unchangedCount} unchanged, ` +
    `${result.legitimateEditCount} edited, ${result.flaggedCount} flagged, ${result.removedCount} removed`;
  await recordPing(c.env, check, archiveStatus, archiveMessage, null);
  await maybeAppendLedgerEntry(c.env, check, archiveStatus, archiveMessage);

  if (result.flaggedCount > 0) {
    const channels = await listAlertChannelsForUser(c.env, check.user_id);
    for (const channel of channels) {
      await dispatchAlert(c.env, channel, {
        check,
        reason: "anomaly",
        detail:
          `${result.flaggedCount} file(s) in this archive changed content with no matching size/modification-time ` +
          `change — possible silent corruption (bit rot). Check the dashboard for which files.`,
      });
    }
  }

  return c.json({ ok: true, ...result });
});

// --- Backup config & retention policy auditor — see src/audit-rules.ts's
// file comment for why Kopia and restic/Borg use genuinely different
// request shapes (a real introspectable policy vs. an agent-declared
// string). Reports the check's current policy alongside the normal ping;
// findings replace whatever was there before (see migrations/0010's
// comment).
app.post("/ping/:token/config-audit", async (c) => {
  const token = c.req.param("token");
  const check = await getCheckByPingToken(c.env, token);
  if (!check) return c.text("unknown ping token", 404);
  const owner = await getUserById(c.env, check.user_id);
  if (!isProUser(owner)) return c.json({ error: PRO_UPGRADE_MESSAGE }, 402);

  const limit = await checkRateLimit(c.env, `config-audit:${token}`, 10, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  if (check.backend === "kopia") {
    const body = await c.req.json<{ kopia_policy?: unknown }>().catch(() => ({}) as { kopia_policy?: unknown });
    const policy = body.kopia_policy;
    if (!isKopiaPolicySnapshot(policy)) {
      return c.json({ error: "kopia_policy must include retention, errorHandling, and compression fields" }, 400);
    }
    const findings = auditKopiaPolicy(policy);
    await replaceConfigAuditFindings(c.env, check.id, findings);
    return c.json({ ok: true, findings });
  }

  if (check.backend === "restic" || check.backend === "borg") {
    // newest_snapshot_time / oldest_snapshot_time are optional, best-effort
    // additions (2026-07-25, see auditRetentionFlags()'s comment in
    // src/audit-rules.ts) — a malformed or absent value just means the two
    // snapshot-age rules don't fire, same as the rest of this endpoint's
    // "missing optional data skips that rule" pattern; it never fails the
    // whole audit the way a missing retention_policy does.
    const body = await c.req
      .json<{ retention_policy?: unknown; newest_snapshot_time?: unknown; oldest_snapshot_time?: unknown }>()
      .catch(
        () =>
          ({}) as { retention_policy?: unknown; newest_snapshot_time?: unknown; oldest_snapshot_time?: unknown },
      );
    if (typeof body.retention_policy !== "string" || !body.retention_policy.trim()) {
      return c.json({ error: "retention_policy must be a non-empty string of the flags this check's prune job uses" }, 400);
    }
    const findings = auditRetentionFlags(check.backend, body.retention_policy, {
      newestSnapshotTime: typeof body.newest_snapshot_time === "string" ? body.newest_snapshot_time : undefined,
      oldestSnapshotTime: typeof body.oldest_snapshot_time === "string" ? body.oldest_snapshot_time : undefined,
    });
    await replaceConfigAuditFindings(c.env, check.id, findings);
    return c.json({ ok: true, findings });
  }

  // Duplicati: same "agent declares its own literal flags" shape as
  // restic/Borg above (same request body field, `retention_policy`) — see
  // auditDuplicatiRetention()'s comment in src/audit-rules.ts for why a
  // real verified test found Duplicati needs its OWN rule set rather than
  // reusing auditRetentionFlags(), even though the request shape is
  // identical.
  if (check.backend === "duplicati") {
    const body = await c.req
      .json<{ retention_policy?: unknown }>()
      .catch(() => ({}) as { retention_policy?: unknown });
    if (typeof body.retention_policy !== "string" || !body.retention_policy.trim()) {
      return c.json({ error: "retention_policy must be a non-empty string of the flags this check's backup job uses" }, 400);
    }
    const findings = auditDuplicatiRetention(body.retention_policy);
    await replaceConfigAuditFindings(c.env, check.id, findings);
    return c.json({ ok: true, findings });
  }

  return c.json({ error: "config-audit currently only supports the 'kopia', 'restic', 'borg', and 'duplicati' backends" }, 400);
});

function isKopiaPolicySnapshot(value: unknown): value is KopiaPolicySnapshot {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const retention = v.retention as Record<string, unknown> | undefined;
  const errorHandling = v.errorHandling as Record<string, unknown> | undefined;
  const compression = v.compression as Record<string, unknown> | undefined;
  const retentionKeys = ["keepLatest", "keepHourly", "keepDaily", "keepWeekly", "keepMonthly", "keepAnnual"];
  return (
    typeof retention === "object" &&
    retention !== null &&
    retentionKeys.every((k) => typeof retention[k] === "number") &&
    typeof errorHandling === "object" &&
    errorHandling !== null &&
    typeof errorHandling.ignoreFileErrors === "boolean" &&
    typeof errorHandling.ignoreDirectoryErrors === "boolean" &&
    typeof compression === "object" &&
    compression !== null &&
    typeof compression.compressorName === "string"
  );
}

app.get("/api/checks/:id/config-audit", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const checks = await listChecksForUser(c.env, user.id);
  const check = checks.find((ch) => ch.id === c.req.param("id"));
  if (!check) return c.json({ error: "check not found" }, 404);
  return c.json(await getConfigAuditFindings(c.env, check.id));
});

// --- Automated restore drills — see PRO_FEATURES_ROADMAP.md item 5 and
// migrations/0013_restore_drills.sql. A drill is a SEPARATE signal from the
// check's normal pass/fail ping, not a replacement for it: this endpoint
// deliberately never calls recordPing()/touches checks.last_status — a
// restic/Borg/Kopia/Duplicati check's regular verification result and its
// occasional restore-drill result are two different questions ("is the
// repo structurally sound" vs. "does a real recovery actually work end to
// end"), and conflating them would let a drill failure silently overwrite
// or be overwritten by the next routine ping. Reported via query params
// like the base ping, not a JSON body like archive-sync — a drill result
// is a handful of scalars, not a variable-length file manifest.
app.get("/ping/:token/drill", (c) => handleDrill(c));
app.post("/ping/:token/drill", (c) => handleDrill(c));

async function handleDrill(c: any): Promise<Response> {
  const token = c.req.param("token");
  const check = await getCheckByPingToken(c.env, token);
  if (!check) return c.text("unknown ping token", 404);

  const owner = await getUserById(c.env, check.user_id);
  if (!isProUser(owner)) return c.json({ error: PRO_UPGRADE_MESSAGE }, 402);

  // Drills are expected to run on a slow, deliberate cadence (weekly/
  // monthly — an actual restore isn't cheap), same reasoning as
  // archive-sync's low ceiling, not the 30/min base-ping limit.
  const limit = await checkRateLimit(c.env, `drill:${token}`, 10, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  const statusRaw = c.req.query("status");
  if (statusRaw !== "pass" && statusRaw !== "fail") {
    return c.json({ error: "status must be 'pass' or 'fail'" }, 400);
  }
  const durationRaw = c.req.query("duration_ms");
  const durationMs = durationRaw ? Number(durationRaw) : NaN;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    return c.json({ error: "duration_ms is required and must be a non-negative number" }, 400);
  }
  const filesRestoredRaw = c.req.query("files_restored");
  const filesExpectedRaw = c.req.query("files_expected");
  const filesRestored = filesRestoredRaw !== undefined ? Number(filesRestoredRaw) : null;
  const filesExpected = filesExpectedRaw !== undefined ? Number(filesExpectedRaw) : null;
  if (
    (filesRestored !== null && !Number.isFinite(filesRestored)) ||
    (filesExpected !== null && !Number.isFinite(filesExpected))
  ) {
    return c.json({ error: "files_restored and files_expected must be numbers when present" }, 400);
  }

  const MAX_MESSAGE_LENGTH = 4096; // same cap as the base ping
  const rawMessage = c.req.query("message") ?? null;
  const message = rawMessage !== null ? rawMessage.slice(0, MAX_MESSAGE_LENGTH) : null;

  await recordDrillRun(c.env, check.id, {
    status: statusRaw,
    durationMs,
    filesRestored,
    filesExpected,
    message,
  });

  // Distinct alert reason (see src/alerts.ts) — a failed drill is a
  // meaningfully different, more urgent signal than a failed metadata
  // check: it means an actual recovery attempt didn't work.
  if (statusRaw === "fail") {
    const channels = await listAlertChannelsForUser(c.env, check.user_id);
    for (const channel of channels) {
      await dispatchAlert(c.env, channel, { check, reason: "drill_failed", detail: message });
    }
  }

  return c.json({ ok: true });
}

app.get("/api/checks/:id/drills", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const checks = await listChecksForUser(c.env, user.id);
  const check = checks.find((ch) => ch.id === c.req.param("id"));
  if (!check) return c.json({ error: "check not found" }, 404);
  return c.json(await getRecentDrillRuns(c.env, check.id));
});

// Read-only detail view behind the archive badge on the check card — same
// "reads stay ungated" pattern as config-audit above: a free user's archive
// checks just never accumulate flagged files, so there's nothing to gate.
app.get("/api/checks/:id/archive-files", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const checks = await listChecksForUser(c.env, user.id);
  const check = checks.find((ch) => ch.id === c.req.param("id"));
  if (!check) return c.json({ error: "check not found" }, 404);
  return c.json(await getFlaggedArchiveFiles(c.env, check.id));
});

/**
 * The embeddable "verified X ago" status badge — deliberately public, no
 * auth (see src/badge.ts's own comment). Meant to be dropped into a GitHub
 * README or a homelab dashboard (Homepage, Homarr, Heimdall) via a plain
 * <img src>, so a browser needs to be able to load it with no cookie/API
 * key. A deleted or bad ID renders a neutral "unknown" badge rather than a
 * broken image or a JSON error — an <img> tag has no way to show either
 * gracefully.
 */
app.get("/api/checks/:id/badge.svg", async (c) => {
  const check = await getCheckById(c.env, c.req.param("id"));
  const svg = check ? renderCheckBadge(check, nowSeconds()) : renderUnknownBadge();
  return c.body(svg, 200, { "Content-Type": "image/svg+xml; charset=utf-8" });
});

// --- Insurer-grade verification ledger — see src/ledger.ts,
// migrations/0011, and docs/verifying-the-ledger.md. Deliberately public,
// no auth: the entire point of publishing the key is that anyone (an
// insurer, an auditor, a skeptical user) can verify an export without a
// Vestal account or trusting a Vestal-authenticated response.
app.get("/api/ledger/public-key", (c) => {
  if (!c.env.LEDGER_SIGNING_PUBLIC_KEY) {
    return c.json({ error: "the verification ledger is not configured on this instance" }, 404);
  }
  return c.json({
    algorithm: "Ed25519",
    public_key_base64: c.env.LEDGER_SIGNING_PUBLIC_KEY,
    note: "See docs/verifying-the-ledger.md for how to independently verify an exported chain against this key.",
  });
});

// Lightweight status for the dashboard's ledger section — count, most
// recent entry, and the same self-check the export endpoint runs, without
// making the browser pull every entry just to render a summary line.
app.get("/api/ledger/summary", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const entries = await listLedgerEntriesForUser(c.env, user.id);

  let selfCheck: { valid: boolean; reason: string | null } | null = null;
  if (c.env.LEDGER_SIGNING_PUBLIC_KEY && entries.length > 0) {
    const publicKey = await importSigningPublicKey(c.env.LEDGER_SIGNING_PUBLIC_KEY);
    const result = await verifyLedgerChain(entries, publicKey);
    selfCheck = { valid: result.valid, reason: result.reason };
  }

  return c.json({
    configured: Boolean(c.env.LEDGER_SIGNING_PUBLIC_KEY),
    entry_count: entries.length,
    latest_entry_at: entries.length > 0 ? entries[entries.length - 1].created_at : null,
    self_check: selfCheck,
  });
});

// Plain entry listing for the dashboard's ledger browse view — distinct
// from /export, which wraps entries in the full export envelope (public
// key, self-check, verification note) meant for handing to a third party.
// This is just "show me my own history," most recent first.
app.get("/api/ledger/entries", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const entries = await listLedgerEntriesForUser(c.env, user.id);
  return c.json([...entries].reverse());
});

// CSV variant of the same export — same underlying entries, easier to
// drop straight into a spreadsheet for an auditor/insurer who doesn't want
// to deal with JSON. Deliberately still includes entry_hash/signature/
// prev_hash columns (not stripped for readability) — those are exactly
// what docs/verifying-the-ledger.md's independent verification needs, and
// a "human-friendly" export that silently dropped them would be useless
// as evidence.
function csvField(value: string | null): string {
  if (value === null) return "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

app.get("/api/ledger/export.csv", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const entries = await listLedgerEntriesForUser(c.env, user.id);
  const header = [
    "created_at",
    "check_name",
    "backend",
    "status",
    "message",
    "prev_hash",
    "entry_hash",
    "signature",
  ];
  const rows = entries.map((e) =>
    [
      new Date(e.created_at * 1000).toISOString(),
      e.check_name,
      e.backend,
      e.status,
      e.message,
      e.prev_hash,
      e.entry_hash,
      e.signature,
    ]
      .map(csvField)
      .join(","),
  );
  const csv = [header.join(","), ...rows].join("\r\n") + "\r\n";

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="vestal-ledger-${user.id}.csv"`);
  return c.body(csv);
});

// PDF variant of the same export — same underlying entries, formatted as a
// document suitable for handing directly to an insurer/auditor who wants
// something to read or print rather than a data file to process. Built with
// pdf-lib (pure JS/TypeScript, no native bindings or filesystem access —
// confirmed against its actual published package contents, not just its
// docs, since anything relying on Node's `fs` or a native addon can't run
// in the Workers runtime). Still includes the truncated entry_hash per row
// and the full public key in the header — a human-readable export that hid
// those would be useless for the same reason the CSV export above keeps
// them.
const PDF_PAGE_WIDTH = 612; // US Letter, points
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN = 50;
const PDF_ROW_HEIGHT = 16;

app.get("/api/ledger/export.pdf", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const entries = await listLedgerEntriesForUser(c.env, user.id);

  // Same self-check the JSON/summary endpoints compute — explicitly NOT the
  // trust boundary (see the closing note below), shown here only so the
  // note's reference to "self_check" means something to a reader of just
  // the PDF.
  let selfCheckLabel = "not available (no entries or ledger not configured)";
  if (c.env.LEDGER_SIGNING_PUBLIC_KEY && entries.length > 0) {
    const publicKey = await importSigningPublicKey(c.env.LEDGER_SIGNING_PUBLIC_KEY);
    const result = await verifyLedgerChain(entries, publicKey);
    selfCheckLabel = result.valid ? "valid" : `FAILED (${result.reason})`;
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle("Vestal Verification Ledger Export");
  pdf.setProducer("Vestal");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const columns = [
    { label: "Date", width: 95 },
    { label: "Check", width: 110 },
    { label: "Backend", width: 70 },
    { label: "Result", width: 50 },
    { label: "Entry hash", width: 187 },
  ];

  let page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const drawText = (text: string, x: number, size: number, useBold = false) => {
    page.drawText(text, { x, y, size, font: useBold ? bold : font, color: rgb(0, 0, 0) });
  };

  const drawWrapped = (label: string, value: string, size = 9) => {
    const maxWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
    const prefix = `${label}: `;
    const full = prefix + value;
    // Simple char-budget wrap (Helvetica at this size averages well under
    // this many chars per line for the header fields we actually render —
    // account emails and base64 keys have no spaces to break on, so a
    // width-measuring wrapper would need a hard fallback anyway).
    const approxCharsPerLine = Math.floor(maxWidth / (size * 0.5));
    for (let i = 0; i < full.length; i += approxCharsPerLine) {
      drawText(full.slice(i, i + approxCharsPerLine), PDF_MARGIN, size);
      y -= size + 4;
    }
  };

  const drawTableHeader = () => {
    let x = PDF_MARGIN;
    for (const col of columns) {
      drawText(col.label, x, 9, true);
      x += col.width;
    }
    y -= PDF_ROW_HEIGHT;
    page.drawLine({
      start: { x: PDF_MARGIN, y: y + 5 },
      end: { x: PDF_PAGE_WIDTH - PDF_MARGIN, y: y + 5 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
  };

  const newPage = () => {
    page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    y = PDF_PAGE_HEIGHT - PDF_MARGIN;
    drawTableHeader();
  };

  // Header block: title + the same account/algorithm/public-key fields the
  // JSON export includes.
  drawText("Vestal Verification Ledger Export", PDF_MARGIN, 16, true);
  y -= 24;
  drawWrapped("Account", user.email);
  drawWrapped("Exported at", new Date().toISOString());
  drawWrapped("Algorithm", "Ed25519");
  drawWrapped("Public key (base64)", c.env.LEDGER_SIGNING_PUBLIC_KEY ?? "not configured on this instance");
  drawWrapped("Entries", String(entries.length));
  drawWrapped("Self-check (see note below)", selfCheckLabel);
  y -= 10;

  drawTableHeader();

  for (const entry of entries) {
    if (y < PDF_MARGIN + PDF_ROW_HEIGHT * 3) {
      newPage();
    }
    let x = PDF_MARGIN;
    const truncatedHash = entry.entry_hash.length > 20 ? `${entry.entry_hash.slice(0, 20)}…` : entry.entry_hash;
    const rowValues = [
      new Date(entry.created_at * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z"),
      entry.check_name.length > 22 ? `${entry.check_name.slice(0, 21)}…` : entry.check_name,
      entry.backend,
      entry.status === "pass" ? "PASS" : "FAIL",
      truncatedHash,
    ];
    for (let i = 0; i < columns.length; i++) {
      drawText(rowValues[i], x, 8);
      x += columns[i].width;
    }
    y -= PDF_ROW_HEIGHT;
  }

  if (entries.length === 0) {
    drawText("No verification entries recorded yet.", PDF_MARGIN, 10);
    y -= PDF_ROW_HEIGHT;
  }

  // Closing note — identical wording to the JSON export's `verification_note`
  // field, so a reader of just the PDF gets the same "don't trust self_check
  // alone" caveat rather than a rephrased (and potentially weaker) one.
  if (y < PDF_MARGIN + 60) newPage();
  y -= 20;
  const note =
    "Do not trust self_check alone -- it's Vestal's own server checking its own signatures. " +
    "Independently verify entries/public_key_base64 yourself; see docs/verifying-the-ledger.md.";
  const noteMaxWidth = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
  const approxCharsPerLine = Math.floor(noteMaxWidth / (8 * 0.5));
  for (let i = 0; i < note.length; i += approxCharsPerLine) {
    if (y < PDF_MARGIN) newPage();
    drawText(note.slice(i, i + approxCharsPerLine), PDF_MARGIN, 8);
    y -= 12;
  }

  // pdf-lib's own .d.ts types save()'s return as the ambient `Uint8Array`
  // with no type-argument, which under this project's TS/lib version
  // resolves to `Uint8Array<ArrayBufferLike>` -- narrower than what Hono's
  // `c.body()` accepts (`Uint8Array<ArrayBuffer>`). Re-wrapping copies into
  // a fresh, concretely-typed buffer and satisfies the overload; it's not
  // masking a real runtime issue, just a type-parameter mismatch between
  // the two libraries' declared types.
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await pdf.save());

  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `attachment; filename="vestal-ledger-${user.id}.pdf"`);
  return c.body(bytes);
});

app.get("/api/ledger/export", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const entries = await listLedgerEntriesForUser(c.env, user.id);

  // A self-check for the user's own peace of mind before sending this
  // anywhere — explicitly NOT the trust boundary. The entries + public
  // key below are what a real third party (an insurer, an auditor) checks
  // independently; this field just saves the user a step if they only
  // want a quick sanity check themselves.
  let selfCheck: { valid: boolean; reason: string | null } | null = null;
  if (c.env.LEDGER_SIGNING_PUBLIC_KEY && entries.length > 0) {
    const publicKey = await importSigningPublicKey(c.env.LEDGER_SIGNING_PUBLIC_KEY);
    const result = await verifyLedgerChain(entries, publicKey);
    selfCheck = { valid: result.valid, reason: result.reason };
  }

  return c.json({
    exported_at: new Date().toISOString(),
    account_email: user.email,
    public_key_base64: c.env.LEDGER_SIGNING_PUBLIC_KEY ?? null,
    algorithm: "Ed25519",
    entries,
    self_check: selfCheck,
    verification_note:
      "Do not trust self_check alone — it's Vestal's own server checking its own signatures. " +
      "Independently verify entries/public_key_base64 yourself; see docs/verifying-the-ledger.md.",
  });
});

// --- Billing (Paddle) — see src/billing.ts and migrations/0012_billing.sql.
// Paddle, not Stripe: Stripe has no Morocco presence at all, confirmed
// 2026-07-24 (see src/billing.ts's file comment). Paddle.js runs entirely
// client-side (no server-created checkout session, unlike Stripe) — the
// server's only two jobs are handing the frontend a non-secret client
// token/price id to initialize it, and verifying the webhook Paddle sends
// back once a subscription actually changes state.

// Public on purpose: PADDLE_CLIENT_TOKEN is explicitly a client-side token
// (Paddle's own docs distinguish it from the secret API key), safe to hand
// to any browser — this just lets the frontend initialize Paddle.js
// without baking the token into the built bundle at compile time.
app.get("/api/billing/config", (c) => {
  if (!c.env.PADDLE_CLIENT_TOKEN || !c.env.PADDLE_PRICE_ID_MONTHLY || !c.env.PADDLE_PRICE_ID_ANNUAL) {
    return c.json({ configured: false });
  }
  return c.json({
    configured: true,
    client_token: c.env.PADDLE_CLIENT_TOKEN,
    price_id_monthly: c.env.PADDLE_PRICE_ID_MONTHLY,
    price_id_annual: c.env.PADDLE_PRICE_ID_ANNUAL,
    // Both optional — omitted entirely (not empty strings) when Team isn't
    // configured, so the frontend can tell "not offered" apart from "one
    // price is missing," which would otherwise silently break checkout for
    // whichever cycle was left unset.
    team_price_id_monthly: c.env.PADDLE_PRICE_ID_TEAM_MONTHLY || undefined,
    team_price_id_annual: c.env.PADDLE_PRICE_ID_TEAM_ANNUAL || undefined,
    environment: c.env.PADDLE_ENVIRONMENT === "production" ? "production" : "sandbox",
  });
});

app.get("/api/billing/status", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({ plan: user.plan, plan_updated_at: user.plan_updated_at });
});

/**
 * Self-serve cancellation, called from the dashboard's Plan section.
 * Schedules the cancellation for the END of the current billing period
 * (`effective_from: "next_billing_period"`) rather than cutting access
 * immediately — matches docs/legal copy (see web/src/pages/Legal.tsx's
 * refund policy: "you keep Pro access until the end of the period you
 * already paid for"). This endpoint only asks Paddle to schedule the
 * cancellation; it does NOT touch `plan` itself — that still only ever
 * changes via the webhook, the same single source of truth as everywhere
 * else, once Paddle actually sends the subscription.canceled event when
 * the period ends.
 */
app.post("/api/billing/cancel", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!c.env.PADDLE_API_KEY) {
    return c.json({ error: "Self-serve cancellation isn't configured yet — email support@vestalapp.com instead." }, 501);
  }
  if (!user.paddle_subscription_id) {
    return c.json({ error: "No active subscription found on this account." }, 400);
  }

  const res = await fetch(`${paddleApiBaseUrl(c.env.PADDLE_ENVIRONMENT)}/subscriptions/${user.paddle_subscription_id}/cancel`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.PADDLE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ effective_from: "next_billing_period" }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("Paddle cancel-subscription call failed", res.status, body);
    return c.json({ error: "Couldn't reach Paddle to cancel — try again, or email support@vestalapp.com." }, 502);
  }

  return c.json({ ok: true });
});

/**
 * Receives subscription.* events from Paddle. Verified against the RAW
 * body (see src/billing.ts's comment on why re-serializing breaks
 * signature verification) before anything is parsed or trusted. Fails
 * closed if PADDLE_WEBHOOK_SECRET isn't configured — same convention as
 * ADMIN_API_KEY, not "optional" like email/Turnstile, since an unverified
 * webhook would mean anyone can grant themselves Pro with a forged POST.
 */
app.post("/api/billing/webhook", async (c) => {
  if (!c.env.PADDLE_WEBHOOK_SECRET) {
    return c.json({ error: "billing is not configured on this instance" }, 404);
  }

  const rawBody = await c.req.text();
  const signatureCheck = await verifyPaddleWebhookSignature(
    rawBody,
    c.req.header("paddle-signature"),
    c.env.PADDLE_WEBHOOK_SECRET,
  );
  if (!signatureCheck.valid) {
    return c.json({ error: `invalid webhook signature: ${signatureCheck.reason}` }, 401);
  }

  let event: { event_type?: string; data?: unknown };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "malformed JSON body" }, 400);
  }

  // Only subscription.* events change plan state — transaction.*,
  // customer.*, etc. are ignored rather than erroring, since Paddle sends
  // every event type to the same single webhook URL.
  if (typeof event.event_type !== "string" || !event.event_type.startsWith("subscription.") || !event.data) {
    return c.json({ ok: true, ignored: true });
  }

  const data = event.data as Record<string, unknown>;
  if (typeof data.id !== "string" || typeof data.status !== "string" || typeof data.customer_id !== "string") {
    return c.json({ error: "subscription event missing required fields" }, 400);
  }
  // Paddle's subscription payload carries the subscribed price under
  // items[0].price.id — the only signal that tells a Team checkout apart
  // from a Pro one (see derivePlanUpdate in src/billing.ts). Defensive
  // reads throughout: a malformed/absent items array just means "can't
  // tell," which derivePlanUpdate already treats as "not Team," not a
  // parse error.
  const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
  const firstPrice = items[0]?.price as Record<string, unknown> | undefined;
  const priceId = typeof firstPrice?.id === "string" ? firstPrice.id : null;

  const eventData: PaddleSubscriptionEventData = {
    id: data.id,
    status: data.status,
    customer_id: data.customer_id,
    custom_data: (data.custom_data ?? null) as { user_id?: string } | null,
    price_id: priceId,
  };
  const update = derivePlanUpdate(eventData, {
    monthly: c.env.PADDLE_PRICE_ID_TEAM_MONTHLY,
    annual: c.env.PADDLE_PRICE_ID_TEAM_ANNUAL,
  });

  // custom_data.user_id links the FIRST event for a new checkout (set via
  // Paddle.Checkout.open({ customData: { user_id } }) — see
  // web/src/pages/Dashboard.tsx). Every later event for the same
  // subscription (renewals, cancellations) is looked up by
  // paddle_customer_id instead, since custom_data isn't guaranteed to be
  // resent on every event type.
  let userId = update.userId;
  if (!userId) {
    const existing = await getUserByPaddleCustomerId(c.env, update.paddleCustomerId);
    userId = existing?.id ?? null;
  }
  if (!userId) {
    return c.json({ ok: true, unlinked: true });
  }

  await setUserPlan(c.env, userId, {
    plan: update.plan,
    paddleCustomerId: update.paddleCustomerId,
    paddleSubscriptionId: update.paddleSubscriptionId,
  });

  return c.json({ ok: true });
});

// --- Auth: password + session cookie for the web UI, Bearer API key for
// agents/curl. Both resolve to the same UserRow so every route below just
// asks "who is this," not "how did they prove it." ----------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

app.post("/api/auth/signup", async (c) => {
  // Bounds mass fake-account creation from a single source. 20/hour, not
  // 5: a tighter number looked reasonable on paper but broke on contact
  // with reality — the Playwright suite alone does ~9 real signups per
  // run, all from the same local IP, and a shared IP (office NAT,
  // university network) can legitimately produce a burst of real signups
  // too. 20 still caps a real spam script hard while surviving both.
  const limit = await checkRateLimit(c.env, `signup:${clientIp(c.req.raw)}`, 20, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  const body = await c.req
    .json<{ email?: string; password?: string; turnstile_token?: string }>()
    .catch((): { email?: string; password?: string; turnstile_token?: string } => ({}));
  if (!body.email || !EMAIL_RE.test(body.email)) {
    return c.json({ error: "a valid email is required" }, 400);
  }
  if (!body.password || body.password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }

  // Checked before the (deliberately CPU-costly) password hash below, so a
  // scripted signup flood pays for a cheap network round-trip to fail, not
  // a PBKDF2 run every time.
  if (!(await verifyTurnstileToken(c.env, body.turnstile_token, clientIp(c.req.raw)))) {
    return c.json({ error: "captcha verification failed — reload the page and try again" }, 400);
  }

  const key = generateApiKey();
  const passwordHash = await hashPassword(body.password);
  let user: UserRow;
  try {
    user = await createUser(c.env, body.email, key, passwordHash);
  } catch (err) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "an account with this email already exists" }, 409);
    }
    throw err;
  }

  const session = await createSession(c.env, user.id);
  setSessionCookie(c, session.id);

  // Doesn't block signup on the send, and doesn't block login/dashboard
  // access on verification either — see migrations/0006's comment for why
  // this is deliberately non-blocking.
  await sendVerificationEmail(c, user);

  // Auto-accepts every pending organization invite sent to this email
  // (see migrations/0016_organization_invites.sql) — this is what actually
  // closes the loop on the invite-by-email flow: someone without an
  // account gets invited, signs up with that exact email, and lands
  // already a member, no separate "accept" click needed.
  await consumeOrganizationInvitesForEmail(c.env, user.email, user.id);

  // The API key is only ever shown once, at creation — same convention as
  // most token-issuing APIs. Unlike before, losing it no longer means
  // losing the account: it's a separate, regenerable credential from the
  // email+password login (see POST /api/api-key/regenerate).
  return c.json({ id: user.id, email: user.email, api_key: key });
});

app.post("/api/auth/login", async (c) => {
  // Blunts credential-stuffing/brute-force from a single source — 10
  // attempts per 15 minutes is well above real typo-retry rates but far
  // below what a password-guessing script needs to be effective.
  const limit = await checkRateLimit(c.env, `login:${clientIp(c.req.raw)}`, 10, 900);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  const body = await c.req
    .json<{ email?: string; password?: string }>()
    .catch((): { email?: string; password?: string } => ({}));
  if (!body.email || !body.password) {
    return c.json({ error: "email and password are required" }, 400);
  }

  // The IP limit above stops one source hammering many accounts; this one
  // stops many sources (a botnet) hammering *one* account, which the IP
  // limit alone can't catch. A temporary window rather than a hard lockout
  // on purpose — a permanent-until-reset lockout keyed on a public email
  // address is itself a denial-of-service lever against a known victim.
  const accountLimit = await checkRateLimit(
    c.env,
    `login-account:${body.email.toLowerCase()}`,
    8,
    900,
  );
  if (!accountLimit.allowed) return tooManyRequests(c, accountLimit.retryAfterSeconds);

  const user = await getUserByEmail(c.env, body.email);
  // Constant-shape response either way (bad email vs. bad password) so the
  // endpoint doesn't leak which accounts exist.
  if (!user || !(await verifyPassword(body.password, user.password_hash))) {
    return c.json({ error: "invalid email or password" }, 401);
  }

  // 2FA enabled: the password alone isn't enough to get a session. Issue a
  // short-lived pending-login token instead and make the client complete
  // POST /api/auth/login/totp with a code before any cookie is set.
  if (user.totp_secret) {
    const pending = await createPending2faLogin(c.env, user.id);
    return c.json({ totp_required: true, pending_token: pending.id });
  }

  const session = await createSession(c.env, user.id);
  setSessionCookie(c, session.id);
  return c.json({ id: user.id, email: user.email });
});

app.post("/api/auth/login/totp", async (c) => {
  const body = await c.req
    .json<{ pending_token?: string; code?: string; recovery_code?: string }>()
    .catch((): { pending_token?: string; code?: string; recovery_code?: string } => ({}));
  if (!body.pending_token || (!body.code && !body.recovery_code)) {
    return c.json({ error: "pending_token and a code are required" }, 400);
  }

  const userId = await getValidPending2faLogin(c.env, body.pending_token);
  if (!userId) {
    return c.json({ error: "this login has expired — sign in again" }, 400);
  }

  // Keyed on the resolved user, not the client IP: the whole point of this
  // step is that the password was already right, so the same "many sources
  // hammering one account" reasoning as the password step's account limit
  // applies here too.
  const limit = await checkRateLimit(c.env, `totp-login:${userId}`, 10, 900);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  const user = await getUserById(c.env, userId);
  if (!user || !user.totp_secret) {
    // Account state changed out from under this pending login (2FA was
    // disabled, or the account was deleted) — fail closed.
    return c.json({ error: "this login has expired — sign in again" }, 400);
  }

  const valid = body.code
    ? await verifyTotpCode(user.totp_secret, body.code)
    : await consumeRecoveryCode(c.env, user.id, body.recovery_code!);
  if (!valid) {
    return c.json({ error: "incorrect code" }, 401);
  }

  await deletePending2faLogin(c.env, body.pending_token);
  const session = await createSession(c.env, user.id);
  setSessionCookie(c, session.id);
  return c.json({ id: user.id, email: user.email });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await deleteSession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json({
    id: user.id,
    email: user.email,
    email_verified: user.email_verified_at !== null,
    totp_enabled: user.totp_secret !== null,
    plan: user.plan,
    created_at: user.created_at,
  });
});

app.post("/api/totp/setup", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.totp_secret) return c.json({ error: "two-factor authentication is already enabled" }, 400);

  const secret = generateTotpSecret();
  await setPendingTotpSecret(c.env, user.id, secret);
  return c.json({ secret, otpauth_url: totpAuthUrl(secret, user.email) });
});

app.post("/api/totp/confirm", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.totp_secret) return c.json({ error: "two-factor authentication is already enabled" }, 400);
  if (!user.totp_secret_pending) {
    return c.json({ error: "start setup first with POST /api/totp/setup" }, 400);
  }

  const limit = await checkRateLimit(c.env, `totp-confirm:${user.id}`, 10, 900);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  const body = await c.req.json<{ code?: string }>().catch((): { code?: string } => ({}));
  if (!body.code || !(await verifyTotpCode(user.totp_secret_pending, body.code))) {
    return c.json({ error: "incorrect code" }, 401);
  }

  await enableTotp(c.env, user.id, user.totp_secret_pending);

  // Shown exactly once, same convention as the API key at signup — these
  // are the only way back in if the authenticator app itself is lost.
  const recoveryCodes = Array.from({ length: 10 }, () => generateRecoveryCode());
  await replaceRecoveryCodes(c.env, user.id, recoveryCodes);

  return c.json({ ok: true, recovery_codes: recoveryCodes });
});

// Re-proves the password, same as account deletion — this is a
// security-lowering action, and a stolen/left-open session alone
// shouldn't be enough to strip a second factor off the account.
app.post("/api/totp/disable", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}));
  if (!body.password || !(await verifyPassword(body.password, user.password_hash))) {
    return c.json({ error: "incorrect password" }, 401);
  }
  await disableTotp(c.env, user.id);
  return c.json({ ok: true });
});

app.post("/api/auth/verify-email", async (c) => {
  const body = await c.req.json<{ token?: string }>().catch((): { token?: string } => ({}));
  if (!body.token) return c.json({ error: "a verification token is required" }, 400);

  const tokenRow = await getValidEmailVerificationToken(c.env, body.token);
  if (!tokenRow) {
    return c.json({ error: "this verification link is invalid or has expired" }, 400);
  }

  await markEmailVerified(c.env, tokenRow.user_id);
  await consumeEmailVerificationToken(c.env, body.token);
  return c.json({ ok: true });
});

app.post("/api/auth/resend-verification", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (user.email_verified_at !== null) return c.json({ ok: true, already_verified: true });

  // Same reasoning as forgot-password's per-target limit: a real send costs
  // a Resend call, so this needs its own cap independent of general
  // per-account activity.
  const limit = await checkRateLimit(c.env, `resend-verification:${user.id}`, 3, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);

  await sendVerificationEmail(c, user);
  return c.json({ ok: true });
});

app.post("/api/auth/forgot-password", async (c) => {
  // The most important endpoint to rate limit of the three: unlike
  // signup/login, a successful call here costs a real Resend send and can
  // be aimed at a third party who never asked for it. Limited two ways —
  // by source IP (stop one caller from mass-triggering resets) and by the
  // target email itself (stop repeated resets aimed at one inbox even
  // from different IPs). Both checks run before the constant-response
  // logic below, but the response shape stays identical either way — see
  // that comment for why silence about which case triggered matters here.
  const ipLimit = await checkRateLimit(c.env, `forgot-password-ip:${clientIp(c.req.raw)}`, 10, 3600);
  if (!ipLimit.allowed) return tooManyRequests(c, ipLimit.retryAfterSeconds);

  const body = await c.req
    .json<{ email?: string }>()
    .catch((): { email?: string } => ({}));

  // Constant-shape response regardless of whether the account exists —
  // same reasoning as login's generic "invalid email or password": this
  // endpoint must not be usable to enumerate registered emails.
  if (body.email) {
    const emailLimit = await checkRateLimit(
      c.env,
      `forgot-password-email:${body.email.toLowerCase()}`,
      3,
      3600,
    );
    if (!emailLimit.allowed) return c.json({ ok: true }); // same success shape, just doesn't actually send again

    const user = await getUserByEmail(c.env, body.email);
    if (user) {
      const token = await createPasswordResetToken(c.env, user.id);
      const url = new URL(c.req.url);
      const resetLink = `${url.origin}/reset-password?token=${token.id}`;
      const content: EmailContent = {
        heading: "Reset your password",
        paragraphs: ["Someone (hopefully you) requested a password reset for your Vestal account."],
        cta: { label: "Reset password", url: resetLink },
        footerNote:
          "This link expires in 1 hour and works once. If you didn't request this, you can " +
          "safely ignore this email — your password hasn't been changed.",
      };
      const sent = await sendEmail(
        c.env,
        user.email,
        "Reset your Vestal password",
        renderEmailText(content),
        renderEmailHtml(url.origin, content),
      );
      if (!sent) {
        console.warn(`password reset email could not be sent to user ${user.id}`);
      }
    }
  }

  return c.json({ ok: true });
});

app.post("/api/auth/reset-password", async (c) => {
  const body = await c.req
    .json<{ token?: string; password?: string }>()
    .catch((): { token?: string; password?: string } => ({}));
  if (!body.token) return c.json({ error: "a reset token is required" }, 400);
  if (!body.password || body.password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }

  const resetTokenRow = await getValidPasswordResetToken(c.env, body.token);
  if (!resetTokenRow) {
    return c.json({ error: "this reset link is invalid or has expired" }, 400);
  }

  const passwordHash = await hashPassword(body.password);
  await updateUserPassword(c.env, resetTokenRow.user_id, passwordHash);
  await consumePasswordResetToken(c.env, body.token);
  // Kill every existing session — if the old password leaked, whatever
  // was signed in with it shouldn't get a free pass just because this
  // browser reset the password from a still-valid cookie.
  await deleteAllSessionsForUser(c.env, resetTokenRow.user_id);

  return c.json({ ok: true });
});

app.post("/api/api-key/regenerate", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const key = generateApiKey();
  await regenerateApiKey(c.env, user.id, key);
  return c.json({ api_key: key });
});

// Irreversible, so it requires re-proving the password even though the
// caller is already authenticated — a stolen/left-open session shouldn't
// alone be enough to destroy the account, same reasoning as most providers'
// "re-enter your password to delete your account" flows.
app.delete("/api/account", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{ password?: string }>().catch((): { password?: string } => ({}));
  if (!body.password || !(await verifyPassword(body.password, user.password_hash))) {
    return c.json({ error: "incorrect password" }, 401);
  }

  await deleteUser(c.env, user.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// A "delete my account" button existed already (DangerZone); "download
// everything you have on me first" didn't. Same auth as every other
// account-scoped route — no extra password re-check like deletion, since
// this is non-destructive and read-only.
app.get("/api/account/export", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const MAX_EXPORTED_PINGS = 10_000;
  const [checks, alertChannels, pings] = await Promise.all([
    listChecksForUser(c.env, user.id),
    listAlertChannelsForUser(c.env, user.id),
    listPingsForUser(c.env, user.id, MAX_EXPORTED_PINGS),
  ]);

  const exportedAt = new Date().toISOString();
  const body = {
    exported_at: exportedAt,
    account: {
      id: user.id,
      email: user.email,
      email_verified: user.email_verified_at !== null,
      created_at: user.created_at,
    },
    checks,
    alert_channels: alertChannels,
    pings,
    pings_note:
      pings.length >= MAX_EXPORTED_PINGS
        ? `Truncated to the ${MAX_EXPORTED_PINGS} most recent pings. Contact support for the complete history.`
        : "Complete ping history for every check you own.",
  };

  c.header("Content-Type", "application/json");
  c.header("Content-Disposition", `attachment; filename="vestal-export-${user.id}.json"`);
  return c.body(JSON.stringify(body, null, 2));
});

async function requireUser(c: any): Promise<UserRow | null> {
  const auth = c.req.header("authorization") ?? "";
  const bearerKey = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (bearerKey) return getUserByApiKey(c.env, bearerKey);

  const sessionCookie = getCookie(c, SESSION_COOKIE);
  if (sessionCookie) return getUserBySessionToken(c.env, sessionCookie);

  return null;
}

/**
 * Deliberately independent of requireUser() above — this is not "a user
 * with an admin flag" (there is no role system, and bolting one on for a
 * single operator would be unused complexity), it's a completely separate
 * bearer secret that only the operator holds. A regular user's session
 * cookie or API key, however privileged-looking, can never satisfy this.
 */
function requireAdmin(c: any): boolean {
  if (!c.env.ADMIN_API_KEY) return false;
  const auth = c.req.header("authorization") ?? "";
  const bearerKey = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!bearerKey) return false;
  return timingSafeEqualStrings(bearerKey, c.env.ADMIN_API_KEY);
}

// --- Admin: read-only account visibility + the ability to actually
// remove an abusive account, neither of which existed before (see
// STATUS.md's "no admin/bulk-delete path exists" gap). Gated by
// requireAdmin(), not requireUser() — see that function's comment. Every
// route here also rate-limits by IP before checking the key itself, so a
// script hammering guesses at the bearer token can't do so unboundedly
// even though the key is high-entropy and requireAdmin() compares it in
// constant time.
app.get("/api/admin/users", async (c) => {
  const limit = await checkRateLimit(c.env, `admin-auth:${clientIp(c.req.raw)}`, 30, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  return c.json(await listUsersForAdmin(c.env));
});

app.get("/api/admin/users/:id", async (c) => {
  const limit = await checkRateLimit(c.env, `admin-auth:${clientIp(c.req.raw)}`, 30, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  const targetUser = await getUserById(c.env, c.req.param("id"));
  if (!targetUser) return c.json({ error: "user not found" }, 404);

  const [checks, alertChannels] = await Promise.all([
    listChecksForUser(c.env, targetUser.id),
    listAlertChannelsForUser(c.env, targetUser.id),
  ]);

  return c.json({
    id: targetUser.id,
    email: targetUser.email,
    created_at: targetUser.created_at,
    email_verified: targetUser.email_verified_at !== null,
    totp_enabled: targetUser.totp_secret !== null,
    checks,
    alert_channels: alertChannels,
  });
});

// No password re-confirmation the way a user's own self-deletion requires
// (POST /api/account) — the admin key itself is the authority here,
// there's no second factor to re-check on top of it, same as any other
// admin action this route group grants.
app.delete("/api/admin/users/:id", async (c) => {
  const limit = await checkRateLimit(c.env, `admin-auth:${clientIp(c.req.raw)}`, 30, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  const targetUser = await getUserById(c.env, c.req.param("id"));
  if (!targetUser) return c.json({ error: "user not found" }, 404);

  await deleteUser(c.env, targetUser.id);
  return c.json({ ok: true });
});

app.get("/api/admin/stats", async (c) => {
  const limit = await checkRateLimit(c.env, `admin-auth:${clientIp(c.req.raw)}`, 30, 3600);
  if (!limit.allowed) return tooManyRequests(c, limit.retryAfterSeconds);
  if (!requireAdmin(c)) return c.json({ error: "unauthorized" }, 401);

  const users = await listUsersForAdmin(c.env);
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 24 * 60 * 60;
  return c.json({
    total_users: users.length,
    total_checks: users.reduce((sum, u) => sum + u.check_count, 0),
    total_alert_channels: users.reduce((sum, u) => sum + u.alert_channel_count, 0),
    active_last_24h: users.filter((u) => u.last_ping_at !== null && u.last_ping_at >= dayAgo).length,
    unverified_email_count: users.filter((u) => !u.email_verified).length,
  });
});

app.post("/api/checks", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req.json<{
    name?: string;
    backend?: string;
    expected_interval_seconds?: number;
    grace_period_seconds?: number;
    organization_id?: string | null;
    client_id?: string | null;
    drill_interval_seconds?: number | null;
  }>().catch(() => ({}) as any);

  if (!body.name || !body.backend || !body.expected_interval_seconds) {
    return c.json(
      { error: "name, backend, and expected_interval_seconds are required" },
      400,
    );
  }

  // Tagging a check to an org at creation time requires actually being a
  // member of that org — otherwise anyone could silently drop a check into
  // an organization they have no business seeing. client_id is only
  // meaningful once organization_id is set, and isn't independently
  // trusted to belong to that org here — setCheckClient below re-validates
  // that same scoping, same defense-in-depth as everywhere else this check
  // happens.
  let organizationId: string | null = null;
  let clientId: string | null = null;
  if (body.organization_id) {
    const membership = await getOrganizationMembership(c.env, body.organization_id, user.id);
    if (!membership) return c.json({ error: "organization not found" }, 404);
    organizationId = body.organization_id;

    if (body.client_id) {
      const client = await getClientById(c.env, body.client_id);
      if (!client || client.organization_id !== organizationId) {
        return c.json({ error: "client not found in this organization" }, 404);
      }
      clientId = body.client_id;
    }
  }

  // 60s floor keeps a misconfigured (or malicious) check from making the
  // 5-minute cron do meaningless repeat work every tick; 1-year ceiling is
  // just a sanity bound against garbage input, not a real use case.
  const MIN_SECONDS = 60;
  const MAX_SECONDS = 31536000;
  if (
    !Number.isFinite(body.expected_interval_seconds) ||
    body.expected_interval_seconds < MIN_SECONDS ||
    body.expected_interval_seconds > MAX_SECONDS
  ) {
    return c.json(
      { error: `expected_interval_seconds must be between ${MIN_SECONDS} and ${MAX_SECONDS}` },
      400,
    );
  }
  if (
    body.grace_period_seconds !== undefined &&
    (!Number.isFinite(body.grace_period_seconds) ||
      body.grace_period_seconds < 0 ||
      body.grace_period_seconds > MAX_SECONDS)
  ) {
    return c.json({ error: "grace_period_seconds must be a non-negative number" }, 400);
  }
  if (
    body.drill_interval_seconds !== undefined &&
    body.drill_interval_seconds !== null &&
    (!Number.isFinite(body.drill_interval_seconds) ||
      body.drill_interval_seconds < MIN_SECONDS ||
      body.drill_interval_seconds > MAX_SECONDS)
  ) {
    return c.json({ error: "drill_interval_seconds must be a valid duration if set" }, 400);
  }

  // Real usage (a small group monitoring their own backups) never comes
  // close to this — it exists so one account can't grow the checks table
  // without bound, since every row here is also scanned every 5 minutes by
  // the cron in findOverdueChecks().
  const MAX_CHECKS_PER_USER = 200;
  if ((await countChecksForUser(c.env, user.id)) >= MAX_CHECKS_PER_USER) {
    return c.json({ error: `you can have at most ${MAX_CHECKS_PER_USER} checks` }, 400);
  }

  const check = await createCheck(c.env, user.id, {
    name: body.name,
    backend: body.backend,
    expectedIntervalSeconds: body.expected_interval_seconds,
    gracePeriodSeconds: body.grace_period_seconds,
    organizationId,
    clientId,
    drillIntervalSeconds: body.drill_interval_seconds ?? null,
  });

  const url = new URL(c.req.url);
  return c.json({
    ...check,
    ping_url: `${url.origin}/ping/${check.ping_token}`,
  });
});

app.get("/api/checks", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const checks = await listChecksForUser(c.env, user.id);
  return c.json(checks);
});

// Sets or clears (client_id: null equivalent — drill_interval_seconds: null)
// this check's restore-drill reminder cadence. See migrations/0015's
// comment for why this is a reminder schedule, not an actual remote
// trigger — the Worker has no way to run a drill on the user's machine.
app.patch("/api/checks/:id/drill-schedule", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const body = await c.req
    .json<{ drill_interval_seconds?: number | null }>()
    .catch(() => ({}) as { drill_interval_seconds?: number | null });
  const value = body.drill_interval_seconds ?? null;
  if (value !== null && (!Number.isFinite(value) || value < 60 || value > 31536000)) {
    return c.json({ error: "drill_interval_seconds must be a valid duration, or null to clear it" }, 400);
  }

  const ok = await setDrillSchedule(c.env, c.req.param("id"), user.id, value);
  if (!ok) return c.json({ error: "check not found" }, 404);
  return c.json({ ok: true });
});

app.delete("/api/checks/:id", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const deleted = await deleteCheck(c.env, c.req.param("id"), user.id);
  if (!deleted) return c.json({ error: "check not found" }, 404);
  return c.json({ ok: true });
});

app.post("/api/alert-channels", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const body = await c.req
    .json<{ kind?: string; target?: string }>()
    .catch(() => ({}) as any);
  if (!body.kind || !body.target) {
    return c.json({ error: "kind and target are required" }, 400);
  }
  const validKinds = ["discord", "webhook", "slack", "email"];
  if (!validKinds.includes(body.kind)) {
    return c.json({ error: `kind must be one of: ${validKinds.join(", ")}` }, 400);
  }
  // Discord/webhook/Slack channels all resolve to a URL Vestal's own Worker
  // will later fetch() on the user's behalf — validate it now, at creation
  // time, rather than letting a bad target sit until the first alert fires.
  if (body.kind !== "email" && !isSafeWebhookUrl(body.target)) {
    return c.json(
      { error: "target must be an https:// URL (not localhost or a private/link-local address)" },
      400,
    );
  }

  const MAX_ALERT_CHANNELS_PER_USER = 50;
  if ((await countAlertChannelsForUser(c.env, user.id)) >= MAX_ALERT_CHANNELS_PER_USER) {
    return c.json({ error: `you can have at most ${MAX_ALERT_CHANNELS_PER_USER} alert channels` }, 400);
  }

  const channel = await createAlertChannel(c.env, user.id, body.kind, body.target);
  return c.json(channel);
});

app.get("/api/alert-channels", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json(await listAlertChannelsForUser(c.env, user.id));
});

app.delete("/api/alert-channels/:id", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  const deleted = await deleteAlertChannel(c.env, c.req.param("id"), user.id);
  if (!deleted) return c.json({ error: "alert channel not found" }, 404);
  return c.json({ ok: true });
});

// --- MSP / Team tier — see PRO_FEATURES_ROADMAP.md item 6 and
// migrations/0014_organizations.sql. Org *creation* still only requires
// Pro (any Pro user can start an org and try it with a few clients) — the
// dedicated Team price (real Paddle price, added 2026-07-25) gates on
// growing past FREE_ORG_CLIENT_LIMIT clients instead, so a small
// consultancy never has to pay more than Pro, matching what ForMSPs.tsx
// already promises them.

/** Clients per organization allowed on Pro before Team is required. Small
 * on purpose: past this, an MSP is squarely in the market Team is priced
 * against (see PRO_FEATURES_ROADMAP.md's $2-25/endpoint/month comp data),
 * not the solo/small-consultancy case Pro is meant to cover for free. */
const FREE_ORG_CLIENT_LIMIT = 5;

app.post("/api/organizations", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  if (!isProUser(user)) return c.json({ error: PRO_UPGRADE_MESSAGE }, 402);

  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  if (!body.name || !body.name.trim()) return c.json({ error: "name is required" }, 400);

  const org = await createOrganization(c.env, user.id, body.name.trim());
  return c.json({ ...org, role: "owner" });
});

app.get("/api/organizations", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  return c.json(await listOrganizationsForUser(c.env, user.id));
});

/** Every /api/organizations/:id/* route below shares the same "am I even
 * a member" gate — factored out so each route doesn't re-implement it. */
async function requireOrgMembership(c: any, orgId: string) {
  const user = await requireUser(c);
  if (!user) return { error: c.json({ error: "unauthorized" }, 401) };
  const membership = await getOrganizationMembership(c.env, orgId, user.id);
  if (!membership) return { error: c.json({ error: "organization not found" }, 404) };
  return { user, membership };
}

app.get("/api/organizations/:id", async (c) => {
  const gate = await requireOrgMembership(c, c.req.param("id"));
  if (gate.error) return gate.error;
  const org = await getOrganizationById(c.env, c.req.param("id"));
  if (!org) return c.json({ error: "organization not found" }, 404);
  return c.json({ ...org, role: gate.membership!.role });
});

app.get("/api/organizations/:id/members", async (c) => {
  const gate = await requireOrgMembership(c, c.req.param("id"));
  if (gate.error) return gate.error;
  return c.json(await listOrganizationMembers(c.env, c.req.param("id")));
});

app.post("/api/organizations/:id/members", async (c) => {
  const orgId = c.req.param("id");
  const gate = await requireOrgMembership(c, orgId);
  if (gate.error) return gate.error;
  if (gate.membership!.role !== "owner") return c.json({ error: "only an organization owner can add members" }, 403);

  const body = await c.req
    .json<{ email?: string; role?: string }>()
    .catch(() => ({}) as { email?: string; role?: string });
  if (!body.email) return c.json({ error: "email is required" }, 400);
  const role = body.role === "owner" ? "owner" : "member";

  // If they already have an account, add them directly. If not, create a
  // pending invite and email them a signup link — accepted automatically
  // at signup time (see consumeOrganizationInvitesForEmail, called from
  // POST /api/auth/signup below). Closes the gap this route group's file
  // comment used to describe as "a separate, not-yet-built step."
  const target = await getUserByEmail(c.env, body.email);
  if (target) {
    await addOrganizationMember(c.env, orgId, target.id, role);
    return c.json({ ok: true, invited: false });
  }

  const org = await getOrganizationById(c.env, orgId);
  await createOrganizationInvite(c.env, orgId, body.email, role, gate.user!.id);
  const url = new URL(c.req.url);
  const signupLink = `${url.origin}/signup?invited_email=${encodeURIComponent(body.email)}`;
  const content: EmailContent = {
    heading: "You've been invited to a Vestal organization",
    paragraphs: [
      `${gate.user!.email} invited you to join "${org?.name ?? "an organization"}" on Vestal, a backup-verification ` +
        `service. Create a free account with this email address and you'll automatically get access.`,
    ],
    cta: { label: "Create your account", url: signupLink },
    footerNote: "This invite doesn't expire for 14 days. If you weren't expecting this, you can safely ignore it.",
  };
  const sent = await sendEmail(
    c.env,
    body.email,
    "You've been invited to a Vestal organization",
    renderEmailText(content),
    renderEmailHtml(url.origin, content),
  );
  if (!sent) console.warn(`organization invite email could not be sent to ${body.email}`);
  return c.json({ ok: true, invited: true });
});

app.get("/api/organizations/:id/invites", async (c) => {
  const gate = await requireOrgMembership(c, c.req.param("id"));
  if (gate.error) return gate.error;
  if (gate.membership!.role !== "owner") return c.json({ error: "only an organization owner can see pending invites" }, 403);
  return c.json(await listPendingInvitesForOrganization(c.env, c.req.param("id")));
});

app.delete("/api/organizations/:id/invites/:inviteId", async (c) => {
  const orgId = c.req.param("id");
  const gate = await requireOrgMembership(c, orgId);
  if (gate.error) return gate.error;
  if (gate.membership!.role !== "owner") return c.json({ error: "only an organization owner can revoke invites" }, 403);

  const revoked = await revokeOrganizationInvite(c.env, c.req.param("inviteId"), orgId);
  if (!revoked) return c.json({ error: "invite not found" }, 404);
  return c.json({ ok: true });
});

app.delete("/api/organizations/:id/members/:userId", async (c) => {
  const orgId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const gate = await requireOrgMembership(c, orgId);
  if (gate.error) return gate.error;
  if (gate.membership!.role !== "owner") return c.json({ error: "only an organization owner can remove members" }, 403);

  // A member being removed who is themself the last owner would leave the
  // organization with no one able to manage it at all — block that rather
  // than silently creating an orphaned org.
  const targetMembership = await getOrganizationMembership(c.env, orgId, targetUserId);
  if (targetMembership?.role === "owner" && (await countOrganizationOwners(c.env, orgId)) <= 1) {
    return c.json({ error: "can't remove the last owner — promote another member first" }, 400);
  }

  await removeOrganizationMember(c.env, orgId, targetUserId);
  return c.json({ ok: true });
});

app.get("/api/organizations/:id/clients", async (c) => {
  const gate = await requireOrgMembership(c, c.req.param("id"));
  if (gate.error) return gate.error;
  return c.json(await listClientsForOrganization(c.env, c.req.param("id")));
});

app.post("/api/organizations/:id/clients", async (c) => {
  const orgId = c.req.param("id");
  const gate = await requireOrgMembership(c, orgId);
  if (gate.error) return gate.error;

  // Gated on the ORG OWNER's plan, not the acting member's — an org is
  // billed as a unit through whoever owns it, same as every other
  // Pro-gated org action (see requireOrgMembership callers throughout this
  // file). A member who isn't the owner can still hit this ceiling; the
  // upgrade has to come from the owner either way.
  const org = await getOrganizationById(c.env, orgId);
  if (!org) return c.json({ error: "organization not found" }, 404);
  if (!isTeamUser(await getUserById(c.env, org.owner_user_id))) {
    const existingClients = await listClientsForOrganization(c.env, orgId);
    if (existingClients.length >= FREE_ORG_CLIENT_LIMIT) {
      return c.json(
        {
          error: `The Pro plan supports up to ${FREE_ORG_CLIENT_LIMIT} clients per organization. Upgrade to Team for unlimited clients.`,
        },
        402,
      );
    }
  }

  const body = await c.req.json<{ name?: string }>().catch(() => ({}) as { name?: string });
  if (!body.name || !body.name.trim()) return c.json({ error: "name is required" }, 400);

  return c.json(await createClient(c.env, orgId, body.name.trim()));
});

app.delete("/api/organizations/:id/clients/:clientId", async (c) => {
  const orgId = c.req.param("id");
  const gate = await requireOrgMembership(c, orgId);
  if (gate.error) return gate.error;

  const deleted = await deleteClient(c.env, c.req.param("clientId"), orgId);
  if (!deleted) return c.json({ error: "client not found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/organizations/:id/checks", async (c) => {
  const gate = await requireOrgMembership(c, c.req.param("id"));
  if (gate.error) return gate.error;
  return c.json(await listChecksForOrganization(c.env, c.req.param("id")));
});

// White-label export: the org's OWN name in place of Vestal's branding,
// covering every check across every client in one CSV. Deliberately NOT
// built on top of the cryptographic verification ledger (src/ledger.ts) —
// that chain is per-USER by design (see migrations/0011's comment: "one
// hash-chain PER USER, not global"), restructuring it to be org-aware is a
// real, separate piece of crypto-engineering, not a parameterization tweak.
// This is a plain status export instead: current state of every check in
// the org, which is what "give a client a report" actually needs day to
// day.
app.get("/api/organizations/:id/export.csv", async (c) => {
  const gate = await requireOrgMembership(c, c.req.param("id"));
  if (gate.error) return gate.error;
  const org = await getOrganizationById(c.env, c.req.param("id"));
  if (!org) return c.json({ error: "organization not found" }, 404);

  const [checks, clients] = await Promise.all([
    listChecksForOrganization(c.env, org.id),
    listClientsForOrganization(c.env, org.id),
  ]);
  const clientNameById = new Map(clients.map((cl) => [cl.id, cl.name]));

  const header = ["client", "check_name", "backend", "status", "last_checked_in"];
  const rows = checks.map((chk) =>
    [
      chk.client_id ? (clientNameById.get(chk.client_id) ?? "") : "(unassigned)",
      chk.name,
      chk.backend,
      chk.last_status,
      chk.last_ping_at ? new Date(chk.last_ping_at * 1000).toISOString() : "never",
    ]
      .map(csvField)
      .join(","),
  );
  const csv = [`"${org.name} — backup verification report, generated ${new Date().toISOString()}"`, header.join(","), ...rows].join(
    "\r\n",
  ) + "\r\n";

  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${org.name.replace(/[^a-z0-9]+/gi, "-")}-vestal-report.csv"`);
  return c.body(csv);
});

/**
 * The org-wide counterpart to /api/ledger/export.pdf — same pdf-lib
 * pattern (module-level PDF_* layout constants, drawText/newPage helpers
 * defined fresh per request since pdf-lib pages/fonts aren't reusable
 * across documents), but deliberately kept white-label: unlike the ledger
 * PDF's title ("Vestal Verification Ledger Export"), this page's visible
 * content never says "Vestal" — same "no branding baked in" promise
 * export.csv already makes, just as a formatted report instead of a raw
 * CSV. "Vestal" only appears in non-visible PDF metadata (setProducer),
 * exactly like the ledger export does. NOT built on the cryptographic
 * verification ledger (that's a per-user hash chain, not org-aware) — see
 * PRO_FEATURES_ROADMAP.md item 6/7's own scoping note on this; this is
 * current check status only, same data export.csv already reports.
 */
app.get("/api/organizations/:id/export.pdf", async (c) => {
  const gate = await requireOrgMembership(c, c.req.param("id"));
  if (gate.error) return gate.error;
  const org = await getOrganizationById(c.env, c.req.param("id"));
  if (!org) return c.json({ error: "organization not found" }, 404);

  const [checks, clients] = await Promise.all([
    listChecksForOrganization(c.env, org.id),
    listClientsForOrganization(c.env, org.id),
  ]);

  const checksByClient = new Map<string, typeof checks>();
  for (const chk of checks) {
    const key = chk.client_id ?? "";
    checksByClient.set(key, [...(checksByClient.get(key) ?? []), chk]);
  }
  const clientGroups: Array<{ label: string; rows: typeof checks }> = [
    ...clients.map((cl) => ({ label: cl.name, rows: checksByClient.get(cl.id) ?? [] })),
    ...(checksByClient.has("") ? [{ label: "Unassigned", rows: checksByClient.get("") ?? [] }] : []),
  ];

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${org.name} — Backup Verification Report`);
  pdf.setProducer("Vestal");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const columns = [
    { label: "Check", width: 180 },
    { label: "Backend", width: 90 },
    { label: "Status", width: 90 },
    { label: "Last checked in", width: 152 },
  ];

  let page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
  let y = PDF_PAGE_HEIGHT - PDF_MARGIN;

  const drawText = (text: string, x: number, size: number, useBold = false) => {
    page.drawText(text, { x, y, size, font: useBold ? bold : font, color: rgb(0, 0, 0) });
  };

  const drawTableHeader = () => {
    let x = PDF_MARGIN;
    for (const col of columns) {
      drawText(col.label, x, 9, true);
      x += col.width;
    }
    y -= PDF_ROW_HEIGHT;
    page.drawLine({
      start: { x: PDF_MARGIN, y: y + 5 },
      end: { x: PDF_PAGE_WIDTH - PDF_MARGIN, y: y + 5 },
      thickness: 0.5,
      color: rgb(0.6, 0.6, 0.6),
    });
  };

  const newPage = () => {
    page = pdf.addPage([PDF_PAGE_WIDTH, PDF_PAGE_HEIGHT]);
    y = PDF_PAGE_HEIGHT - PDF_MARGIN;
  };

  // Returns whether it actually broke to a new page, so callers that need
  // the column header redrawn after a break (see the per-row loop below)
  // can do so — callers that redraw their own header unconditionally
  // anyway (the per-group start, which always draws the client label +
  // header together) can ignore the return value.
  const ensureRoom = (minRows = 1): boolean => {
    if (y < PDF_MARGIN + PDF_ROW_HEIGHT * (minRows + 2)) {
      newPage();
      return true;
    }
    return false;
  };

  drawText(`${org.name} — Backup Verification Report`, PDF_MARGIN, 16, true);
  y -= 22;
  drawText(`Generated ${new Date().toISOString()}`, PDF_MARGIN, 9);
  y -= 24;

  if (clientGroups.length === 0) {
    drawText("No clients or checks recorded yet.", PDF_MARGIN, 10);
  }

  for (const group of clientGroups) {
    ensureRoom(2);
    drawText(group.label, PDF_MARGIN, 12, true);
    y -= PDF_ROW_HEIGHT;
    drawTableHeader();

    if (group.rows.length === 0) {
      drawText("No checks assigned yet.", PDF_MARGIN, 9);
      y -= PDF_ROW_HEIGHT;
    }

    for (const chk of group.rows) {
      ensureRoom();
      let x = PDF_MARGIN;
      const rowValues = [
        chk.name.length > 30 ? `${chk.name.slice(0, 29)}…` : chk.name,
        chk.backend,
        chk.last_status,
        chk.last_ping_at ? new Date(chk.last_ping_at * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z") : "never",
      ];
      for (let i = 0; i < columns.length; i++) {
        drawText(rowValues[i], x, 8);
        x += columns[i].width;
      }
      y -= PDF_ROW_HEIGHT;
    }
    y -= PDF_ROW_HEIGHT / 2;
  }

  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await pdf.save());

  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `attachment; filename="${org.name.replace(/[^a-z0-9]+/gi, "-")}-vestal-report.pdf"`);
  return c.body(bytes);
});

// Moves a check to a different client within the org it already belongs
// to (or unassigns it with client_id: null) — scoped through setCheckClient
// so a member of one org can't relabel a check belonging to another.
app.patch("/api/checks/:id/client", async (c) => {
  const user = await requireUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);

  const checks = await listChecksForUser(c.env, user.id);
  let check = checks.find((ch) => ch.id === c.req.param("id"));
  let organizationId = check?.organization_id ?? null;

  // The check might belong to an org the current user is a member of even
  // if they didn't personally create it — listChecksForUser only covers
  // checks this user OWNS, so fall back to checking org membership via the
  // check's own organization_id before giving up.
  if (!check) {
    const anyCheck = await c.env.DB.prepare("SELECT * FROM checks WHERE id = ?")
      .bind(c.req.param("id"))
      .first<typeof checks[number]>();
    if (!anyCheck || !anyCheck.organization_id) return c.json({ error: "check not found" }, 404);
    const membership = await getOrganizationMembership(c.env, anyCheck.organization_id, user.id);
    if (!membership) return c.json({ error: "check not found" }, 404);
    check = anyCheck;
    organizationId = anyCheck.organization_id;
  }
  if (!organizationId) return c.json({ error: "this check doesn't belong to an organization" }, 400);

  const body = await c.req.json<{ client_id?: string | null }>().catch(() => ({}) as { client_id?: string | null });
  const ok = await setCheckClient(c.env, check.id, organizationId, body.client_id ?? null);
  if (!ok) return c.json({ error: "couldn't update this check" }, 400);
  return c.json({ ok: true });
});

async function runScheduledTasks(env: Env): Promise<void> {
  const overdue = await findOverdueChecks(env);
  for (const check of overdue) {
    const channels = await listAlertChannelsForUser(env, check.user_id);
    const reason = check.last_status === "fail" ? "failed" : "late";

    let anySent = false;
    for (const channel of channels) {
      const sent = await dispatchAlert(env, channel, { check, reason });
      anySent = anySent || sent;
    }

    if (channels.length === 0) {
      console.warn(
        `check ${check.id} (${check.name}) is overdue but user ${check.user_id} has no alert channels configured`,
      );
    } else if (!anySent) {
      console.warn(
        `check ${check.id} (${check.name}) is overdue but no configured alert channel could actually be dispatched`,
      );
    }

    // Preserve the actual status ("fail" stays "fail") — previously this
    // hardcoded "late" here, silently overwriting a genuine failure back
    // to a misleading "just running behind" status right after alerting
    // on it.
    const settledStatus: CheckStatus = reason === "failed" ? "fail" : "late";
    await markAlerted(env, check.id, settledStatus);
  }

  // Restore-drill reminders — see migrations/0015_drill_scheduling.sql.
  // Same sweep, same alert-dispatch machinery as the overdue-check loop
  // above, distinct "drill_overdue" reason (src/alerts.ts) so it reads as
  // "you're due for a drill" rather than "your backup is broken."
  const overdueDrills = await findOverdueDrillChecks(env);
  for (const check of overdueDrills) {
    const channels = await listAlertChannelsForUser(env, check.user_id);
    for (const channel of channels) {
      await dispatchAlert(env, channel, { check, reason: "drill_overdue" });
    }
    await markDrillReminded(env, check.id);
  }

  // Rate-limit windows are all well under a day long (see ratelimit.ts)
  // — anything older than 2 days is dead weight, never queried again.
  await pruneRateLimits(env, 2 * 24 * 60 * 60);
}

export default {
  fetch: app.fetch,

  // The actual product, running every 5 minutes (see wrangler.jsonc):
  // find every check that's gone quiet past its grace period, and make
  // sure a human finds out before they need the backup, not after.
  //
  // Wrapped in try/catch for a real reason, not defensively: this is the
  // one piece of code where a silent failure is the worst possible
  // outcome — if the alerting mechanism itself breaks, nobody would ever
  // find out, which defeats the entire product. On any uncaught error,
  // self-alert to OWNER_EMAIL via the same sendEmail() path already
  // proven for user-facing mail, then rethrow so Cloudflare's own
  // cron-retry behavior still gets a chance to run it again.
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    try {
      await runScheduledTasks(env);
    } catch (err) {
      const message = err instanceof Error ? `${err.message}\n${err.stack ?? ""}` : String(err);
      console.error("scheduled() failed:", message);
      if (env.OWNER_EMAIL) {
        await sendEmail(
          env,
          env.OWNER_EMAIL,
          "Vestal: the alerting cron just failed",
          `The scheduled check-alert cron threw an uncaught error:\n\n${message}\n\n` +
            `This means overdue/failed checks may not have been alerted on this tick. ` +
            `Check \`wrangler tail\` for the full picture.`,
        ).catch((sendErr) => console.error("also failed to send the self-alert email:", sendErr));
      }
      throw err;
    }
  },
};
