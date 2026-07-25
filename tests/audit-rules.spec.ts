import { test, expect } from "@playwright/test";
import { auditDuplicatiRetention, auditKopiaPolicy, auditRetentionFlags, type KopiaPolicySnapshot } from "../src/audit-rules";

// All three fixtures below are REAL `kopia policy show --global --json`
// output from a real local repo (Kopia 0.23.1, 2026-07-24) — the default
// policy, then the same repo after `kopia policy set` actually applied
// each risky change, not hand-written JSON guessing at the shape.

const SAFE_DEFAULT: KopiaPolicySnapshot = {
  retention: { keepLatest: 10, keepHourly: 48, keepDaily: 7, keepWeekly: 4, keepMonthly: 24, keepAnnual: 3 },
  errorHandling: { ignoreFileErrors: false, ignoreDirectoryErrors: false },
  compression: { compressorName: "none" },
};

const IGNORE_ERRORS_ENABLED: KopiaPolicySnapshot = {
  retention: { keepLatest: 10, keepHourly: 48, keepDaily: 7, keepWeekly: 4, keepMonthly: 24, keepAnnual: 3 },
  errorHandling: { ignoreFileErrors: true, ignoreDirectoryErrors: true },
  compression: { compressorName: "none" },
};

const ZERO_RETENTION: KopiaPolicySnapshot = {
  retention: { keepLatest: 0, keepHourly: 0, keepDaily: 0, keepWeekly: 0, keepMonthly: 0, keepAnnual: 0 },
  errorHandling: { ignoreFileErrors: true, ignoreDirectoryErrors: true },
  compression: { compressorName: "none" },
};

test("Kopia's real default policy: only the compression info note fires, nothing else", () => {
  const findings = auditKopiaPolicy(SAFE_DEFAULT);
  const ids = findings.map((f) => f.id);
  expect(ids).toEqual(["kopia-no-compression"]);
  expect(findings[0].severity).toBe("info");
});

test("ignoreFileErrors/ignoreDirectoryErrors enabled fires a warning", () => {
  const findings = auditKopiaPolicy(IGNORE_ERRORS_ENABLED);
  const ignoreErrorsFinding = findings.find((f) => f.id === "kopia-ignore-errors");
  expect(ignoreErrorsFinding).toBeDefined();
  expect(ignoreErrorsFinding?.severity).toBe("warning");
});

test("all-zero retention fires a warning, on top of the other two", () => {
  const findings = auditKopiaPolicy(ZERO_RETENTION);
  const ids = findings.map((f) => f.id).sort();
  expect(ids).toEqual(["kopia-ignore-errors", "kopia-no-compression", "kopia-zero-retention"]);
});

test("a fully tuned, safe policy produces no findings at all", () => {
  const tuned: KopiaPolicySnapshot = {
    retention: { keepLatest: 10, keepHourly: 0, keepDaily: 7, keepWeekly: 4, keepMonthly: 12, keepAnnual: 1 },
    errorHandling: { ignoreFileErrors: false, ignoreDirectoryErrors: false },
    compression: { compressorName: "zstd-fastest" },
  };
  expect(auditKopiaPolicy(tuned)).toEqual([]);
});

// --- restic/Borg: auditRetentionFlags() -------------------------------
// See src/audit-rules.ts's file comment for why this is a separate,
// narrower rule set than Kopia's — the input is a literal declared CLI
// flag string (VESTAL_RETENTION_POLICY), not an introspected policy.

test("a real, sane restic retention flag string produces no findings", () => {
  expect(auditRetentionFlags("restic", "--keep-daily 7 --keep-weekly 4 --keep-monthly 6")).toEqual([]);
});

test("a real, sane Borg retention flag string produces no findings", () => {
  expect(auditRetentionFlags("borg", "--keep-daily=7 --keep-weekly=4")).toEqual([]);
});

test("every keep count at zero fires a zero-retention warning", () => {
  const findings = auditRetentionFlags("restic", "--keep-daily 0 --keep-weekly 0");
  expect(findings).toHaveLength(1);
  expect(findings[0].id).toBe("restic-zero-retention");
  expect(findings[0].severity).toBe("warning");
});

test("no recognized --keep-* flag at all fires a distinct warning (typo/wrong-tool guard)", () => {
  const findings = auditRetentionFlags("borg", "--compression zstd --verbose");
  expect(findings).toHaveLength(1);
  expect(findings[0].id).toBe("borg-no-recognized-retention-flags");
});

test("an empty/whitespace-only string is treated the same as no recognized flags", () => {
  const findings = auditRetentionFlags("restic", "   ");
  expect(findings[0].id).toBe("restic-no-recognized-retention-flags");
});

test("--keep-last counts toward a real (non-zero) policy, not just --keep-daily/weekly/monthly", () => {
  expect(auditRetentionFlags("restic", "--keep-last 10")).toEqual([]);
});

// --- restic/Borg: the two snapshot-age rules added 2026-07-25 --------------
// See auditRetentionFlags()'s comment in src/audit-rules.ts for the exact
// thresholds and why they're derived from the declared policy's own
// implied cadence/span rather than a fixed number. The ISO-8601 timestamp
// SHAPES used below (fractional-second offset for restic, no-timezone
// microseconds for Borg) are copied from real output, not guessed:
//   - restic: a real local restic 0.19.1 repo, `restic snapshots --json`,
//     including a genuinely backdated snapshot via `restic backup --time
//     "2026-07-13 10:00:00"` — real output: "2026-07-13T10:00:00+01:00".
//   - Borg: a real local Borg 1.4.4 repo (via WSL), `borg list --json`,
//     including a genuinely backdated archive via `borg create --timestamp
//     "2026-06-01T10:00:00"` — real output: "2026-06-01T10:00:00.000000".
// Test timestamps below are computed relative to "now" (not those exact
// captured calendar dates) so this suite stays valid indefinitely instead
// of quietly rotting into false failures/passes as real time moves past a
// hardcoded date.
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

test("newest snapshot far older than the declared policy's cadence fires a stale-schedule warning (the roadmap's own 'keep-daily 7, 12 days old' example)", () => {
  const findings = auditRetentionFlags("restic", "--keep-daily 7", {
    newestSnapshotTime: daysAgo(12),
    oldestSnapshotTime: daysAgo(12),
  });
  const ids = findings.map((f) => f.id);
  expect(ids).toContain("restic-newest-snapshot-stale");
  expect(findings.find((f) => f.id === "restic-newest-snapshot-stale")?.severity).toBe("warning");
});

test("newest snapshot within the policy's own cadence produces no stale-schedule finding", () => {
  const findings = auditRetentionFlags("restic", "--keep-daily 7", {
    newestSnapshotTime: daysAgo(1),
    oldestSnapshotTime: daysAgo(1),
  });
  expect(findings.map((f) => f.id)).not.toContain("restic-newest-snapshot-stale");
});

test("oldest snapshot far outliving the declared policy's total retention span fires a prune-not-effective warning", () => {
  const findings = auditRetentionFlags("borg", "--keep-daily=7", {
    newestSnapshotTime: daysAgo(0),
    oldestSnapshotTime: daysAgo(54),
  });
  const finding = findings.find((f) => f.id === "borg-prune-not-effective");
  expect(finding).toBeDefined();
  expect(finding?.severity).toBe("warning");
});

test("a real, healthy repo (recent snapshots, oldest snapshot within the policy's own span) produces no findings at all", () => {
  // Mirrors the real, non-backdated restic repo used to verify this
  // (two real snapshots ~1 minute apart, `--keep-daily 7 --keep-weekly 4`).
  expect(
    auditRetentionFlags("restic", "--keep-daily 7 --keep-weekly 4", {
      newestSnapshotTime: daysAgo(0),
      oldestSnapshotTime: daysAgo(0),
    }),
  ).toEqual([]);
});

test("a wide but genuinely-honored retention span (oldest snapshot well inside it) produces no prune-not-effective finding", () => {
  // Same real Borg oldest/newest gap (~54 days) as the prune-not-effective
  // test above, but with a policy whose declared span genuinely covers it
  // (`--keep-daily=7 --keep-monthly=6` implies ~187 days) — a real
  // healthy-repo shape, not just a narrower policy re-tested.
  const findings = auditRetentionFlags("borg", "--keep-daily=7 --keep-monthly=6", {
    newestSnapshotTime: daysAgo(0),
    oldestSnapshotTime: daysAgo(54),
  });
  expect(findings).toEqual([]);
});

test("missing snapshot timestamps skip both new rules entirely (best-effort, matches the rest of this endpoint's optional-field handling)", () => {
  expect(auditRetentionFlags("restic", "--keep-daily 7")).toEqual([]);
});

test("only --keep-last/--keep-hourly declared (no daily/weekly/monthly/yearly) skips both new rules even with very old snapshots", () => {
  const findings = auditRetentionFlags("restic", "--keep-last 10", {
    newestSnapshotTime: daysAgo(400),
    oldestSnapshotTime: daysAgo(400),
  });
  expect(findings).toEqual([]);
});

// --- Duplicati: auditDuplicatiRetention() -------------------------------
// Deliberately its OWN rule set, not a call to auditRetentionFlags() with a
// "duplicati" backend added — see that function's file comment in
// src/audit-rules.ts. The zero/-1 cases below are calibrated to REAL
// verified behavior (Duplicati 2.3.0.4, 2026-07-25): a real
// `backup --keep-versions=0` and a real `backup --keep-versions=-1`, each
// run against a real repo that already had multiple versions, deleted
// NOTHING in either case (confirmed via real `list-filesets` output before
// and after), while `--keep-versions=2` on the same repo genuinely pruned
// down to 2 filesets. So 0/-1 mean "unlimited," the opposite of restic/
// Borg's "--keep-* totaling zero" meaning "nothing protected."

test("a real, sane --keep-versions count produces no findings", () => {
  expect(auditDuplicatiRetention("--keep-versions=5")).toEqual([]);
});

test("--keep-versions=1 fires the single-version-retention warning (a real single point of failure)", () => {
  const findings = auditDuplicatiRetention("--keep-versions=1");
  expect(findings).toHaveLength(1);
  expect(findings[0].id).toBe("duplicati-single-version-retention");
  expect(findings[0].severity).toBe("warning");
});

test("--keep-versions=0 fires the unbounded-retention INFO note, not a warning (verified: means unlimited, not zero)", () => {
  const findings = auditDuplicatiRetention("--keep-versions=0");
  expect(findings).toHaveLength(1);
  expect(findings[0].id).toBe("duplicati-unbounded-retention");
  expect(findings[0].severity).toBe("info");
});

test("--keep-versions=-1 fires the same unbounded-retention info note (Duplicati's own documented 'keep all' value)", () => {
  const findings = auditDuplicatiRetention("--keep-versions=-1");
  expect(findings).toHaveLength(1);
  expect(findings[0].id).toBe("duplicati-unbounded-retention");
});

test("--keep-versions=0 alongside a --keep-time does NOT fire unbounded-retention (a real limit exists elsewhere)", () => {
  expect(auditDuplicatiRetention("--keep-versions=0 --keep-time=6M")).toEqual([]);
});

test("a declared --retention-policy alone (no --keep-versions) produces no findings", () => {
  expect(auditDuplicatiRetention("--retention-policy=7D:0s,3M:1D,10Y:2M")).toEqual([]);
});

test("an empty/whitespace-only string fires the no-recognized-flags warning", () => {
  const findings = auditDuplicatiRetention("   ");
  expect(findings).toHaveLength(1);
  expect(findings[0].id).toBe("duplicati-no-recognized-retention-flags");
  expect(findings[0].severity).toBe("warning");
});

test("unrelated flags with no recognized retention flag fire the same warning (typo/wrong-tool guard)", () => {
  const findings = auditDuplicatiRetention("--passphrase=x --no-encryption=false");
  expect(findings[0].id).toBe("duplicati-no-recognized-retention-flags");
});
