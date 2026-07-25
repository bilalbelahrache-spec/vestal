/**
 * Backup config & retention policy auditor — see PRO_FEATURES_ROADMAP.md
 * item 3. Three backends now, two genuinely different designs. Kopia
 * actually stores its retention/error-handling policy server-side as
 * introspectable structured state (`kopia policy show --json`, verified
 * against a real local repo 2026-07-24) — auditKopiaPolicy() below reads
 * that back directly. restic and Borg apply retention via CLI flags at
 * prune time (`restic forget --keep-daily N`, `borg prune --keep-daily N`)
 * with nothing stored in the repo to read back, so those need the AGENT
 * itself to be told the policy (VESTAL_RETENTION_POLICY — see
 * agent/vestal-restic.sh and agent/vestal-borg.sh) rather than discovering
 * it — auditRetentionFlags() below parses that declared string, a real,
 * different, and deliberately narrower design (one rule, not three — see
 * that function's comment). Duplicati was originally assumed to be closer
 * to Kopia here ("its retention policy is a stored backup job setting")
 * but that assumption was WRONG, corrected 2026-07-25 by actually checking
 * a real installed Duplicati 2.3.0.4 CLI: there is no `duplicati-cli
 * policy show` or any other command that reads back a previously-used
 * retention flag (every `help <topic>` command was enumerated — Commands:
 * backup/find/restore/delete/compact/test/compare/purge/vacuum; Searching:
 * list-filesets/list-folder-contents/list-file-versions/search-files;
 * nothing resembling a stored-policy readback). Retention is CLI flags at
 * `backup` time (`--keep-versions=N`, `--retention-policy=...`,
 * `--keep-time=...`), exactly like restic/Borg — so `auditDuplicatiRetention()`
 * below mirrors `auditRetentionFlags()`'s agent-declared-string design, not
 * `auditKopiaPolicy()`'s. See that function's own comment for why its rules
 * are NOT just a copy of `auditRetentionFlags()`'s, though: a real verified
 * test found Duplicati's zero-value semantics are the OPPOSITE of restic/
 * Borg's.
 */

export interface KopiaPolicySnapshot {
  retention: {
    keepLatest: number;
    keepHourly: number;
    keepDaily: number;
    keepWeekly: number;
    keepMonthly: number;
    keepAnnual: number;
  };
  errorHandling: {
    ignoreFileErrors: boolean;
    ignoreDirectoryErrors: boolean;
  };
  compression: {
    compressorName: string;
  };
}

export interface AuditFinding {
  id: string;
  severity: "info" | "warning";
  message: string;
}

/**
 * Pure function, no I/O — takes the JSON `kopia policy show --json`
 * already produces and returns plain-language findings. Each rule below
 * was checked against a REAL local Kopia repo (0.23.1): the exact JSON
 * shape, field names, and default values are copied from real `kopia
 * policy show --json` output, not guessed from documentation.
 */
export function auditKopiaPolicy(policy: KopiaPolicySnapshot): AuditFinding[] {
  const findings: AuditFinding[] = [];

  // Real, verified default is `false` for both — a user has to have
  // explicitly turned this on. When it's on, a snapshot that hits a
  // permission error or a bad sector on a file/directory silently skips
  // it and still reports success, instead of failing loudly the way
  // Kopia does out of the box.
  if (policy.errorHandling.ignoreFileErrors || policy.errorHandling.ignoreDirectoryErrors) {
    findings.push({
      id: "kopia-ignore-errors",
      severity: "warning",
      message:
        "This policy ignores file/directory read errors instead of failing the snapshot — a permissions " +
        "problem or a bad sector could mean real data is silently missing from your backup while it still " +
        "reports success.",
    });
  }

  const totalRetention =
    policy.retention.keepLatest +
    policy.retention.keepHourly +
    policy.retention.keepDaily +
    policy.retention.keepWeekly +
    policy.retention.keepMonthly +
    policy.retention.keepAnnual;
  if (totalRetention === 0) {
    findings.push({
      id: "kopia-zero-retention",
      severity: "warning",
      message:
        "Every retention count (latest/hourly/daily/weekly/monthly/annual) is set to zero — nothing is " +
        "protected from Kopia's own maintenance/cleanup. If this wasn't intentional, set at least " +
        "keepLatest to a real number.",
    });
  }

  // Kopia's own real default, verified against a fresh repo: compression
  // is OFF unless a user explicitly turns it on. Worth flagging as an
  // informational note (not a real risk) since it's an easy, low-cost win
  // most new users don't discover on their own.
  if (!policy.compression.compressorName || policy.compression.compressorName === "none") {
    findings.push({
      id: "kopia-no-compression",
      severity: "info",
      message:
        "Compression is off (Kopia's own default). Unless your data is already compressed (video, photos, " +
        "existing archives), enabling zstd compression can meaningfully shrink storage use at low CPU cost.",
    });
  }

  return findings;
}

/**
 * restic and Borg auditing — see the file comment above for why this is a
 * genuinely different design from Kopia's: there's no stored policy to
 * introspect, so the agent has to be TOLD the policy it's already passing
 * to `restic forget`/`borg prune` (via VESTAL_RETENTION_POLICY — see
 * agent/vestal-restic.sh and agent/vestal-borg.sh), and this just parses
 * that literal flag string back out. Started with ONE rule (matches this
 * file's "start narrow, grow rule-by-rule" pattern already used for
 * Kopia): flag when no real retention is declared at all, either because
 * every `--keep-*` count parses to zero, or because none of the flags
 * restic/Borg actually document were found in the string (a typo'd flag
 * name silently keeps nothing, same practical risk as writing
 * `--keep-daily 0`).
 *
 * **2026-07-25: the other two footguns from the original plan are now
 * built too** (PRO_FEATURES_ROADMAP.md item 3's "a retention policy that
 * will expire the only clean pre-incident snapshot soon" /
 * "a repo that hasn't actually been pruned in months"). Both need snapshot
 * timestamps the agent didn't previously report — `newestSnapshotTime` /
 * `oldestSnapshotTime` below, now sent by `agent/vestal-restic.sh` /
 * `agent/vestal-borg.sh` (`restic snapshots --json` / `borg list --json`,
 * the same real timestamp field already verified for the ransomware-canary
 * diff-stats section, just min/max instead of the newest two). Neither
 * restic nor Borg records "when did prune last actually run/succeed"
 * anywhere readable — verified by checking `restic --help`, `restic forget
 * --help`, `borg prune --help`, `borg check --help`: no stored prune-
 * history command exists for either tool — so "hasn't been pruned"
 * can't be read back directly either. Both new rules instead infer it from
 * data that IS real and readable: the repository's own actual snapshot
 * ages compared against what the declared `--keep-*` policy implies.
 *
 * Both new checks are keyed off the same four time-bearing flags —
 * `--keep-daily`/`--keep-weekly`/`--keep-monthly`/`--keep-yearly` — with a
 * rough calendar-days-per-unit mapping (1/7/30/365). `--keep-last` (a raw
 * count, not a cadence) and `--keep-hourly` (a real flag, but at a
 * granularity too fine to set a sane multi-day staleness threshold from
 * without a declared backup interval Vestal doesn't have) are deliberately
 * left out of both calculations — narrower than "every keep-* flag," on
 * purpose, matching this file's habit of shipping the well-understood
 * subset first rather than guessing at edge cases. A flag string using
 * only `--keep-last`/`--keep-hourly` (no daily/weekly/monthly/yearly) just
 * skips both new checks — best-effort, same as a missing snapshot
 * timestamp does.
 */
const RESTIC_BORG_KEEP_FLAG_RE = /--keep-[a-z-]+[= ]\s*(\d+)/g;
const KEEP_DAILY_RE = /--keep-daily[= ]\s*(\d+)/;
const KEEP_WEEKLY_RE = /--keep-weekly[= ]\s*(\d+)/;
const KEEP_MONTHLY_RE = /--keep-monthly[= ]\s*(\d+)/;
const KEEP_YEARLY_RE = /--keep-yearly[= ]\s*(\d+)/;

/** Rough calendar-days-per-unit for the four time-bearing `--keep-*` flags. */
const KEEP_FLAG_PERIOD_DAYS: Array<{ re: RegExp; days: number }> = [
  { re: KEEP_DAILY_RE, days: 1 },
  { re: KEEP_WEEKLY_RE, days: 7 },
  { re: KEEP_MONTHLY_RE, days: 30 },
  { re: KEEP_YEARLY_RE, days: 365 },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ResticBorgSnapshotInfo {
  /** ISO-8601 timestamp of the repository's most recent snapshot/archive. */
  newestSnapshotTime?: string;
  /** ISO-8601 timestamp of the repository's oldest surviving snapshot/archive. */
  oldestSnapshotTime?: string;
}

export function auditRetentionFlags(
  backend: "restic" | "borg",
  rawFlags: string,
  snapshotInfo?: ResticBorgSnapshotInfo,
): AuditFinding[] {
  const trimmed = rawFlags.trim();
  const matches = [...trimmed.matchAll(RESTIC_BORG_KEEP_FLAG_RE)];
  const total = matches.reduce((sum, m) => sum + Number(m[1]), 0);

  if (matches.length === 0) {
    return [
      {
        id: `${backend}-no-recognized-retention-flags`,
        severity: "warning",
        message:
          `Vestal couldn't find any recognized "--keep-*" flag (e.g. --keep-daily, --keep-weekly) in the ` +
          `retention policy this check declared. Either nothing is actually being pruned, or the flags are ` +
          `spelled differently than what was reported here — worth double-checking your ${backend === "restic" ? "restic forget" : "borg prune"} command.`,
      },
    ];
  }

  if (total === 0) {
    return [
      {
        id: `${backend}-zero-retention`,
        severity: "warning",
        message:
          `Every "--keep-*" count in this check's declared retention policy is zero — nothing is protected ` +
          `from ${backend === "restic" ? "restic forget --prune" : "borg prune"}. If this wasn't intentional, set ` +
          `at least one keep count to a real number.`,
      },
    ];
  }

  const findings: AuditFinding[] = [];

  // Present time-bearing periods (count > 0) only — a declared but zeroed
  // flag (e.g. "--keep-daily 0 --keep-weekly 4") shouldn't count toward
  // either calculation below, same "only what's actually keeping snapshots
  // counts" logic as the zero-retention check above.
  const presentPeriods = KEEP_FLAG_PERIOD_DAYS.filter(({ re }) => {
    const m = trimmed.match(re);
    return m !== null && Number(m[1]) > 0;
  });

  // Rule: newest snapshot is meaningfully older than the declared policy's
  // own cadence implies it should be (PRO_FEATURES_ROADMAP.md item 3's
  // "keep-daily 7 but the newest snapshot is 12 days old" example
  // verbatim). Threshold is 3x the SHORTEST declared period, floored at 1
  // day, so an occasional missed run (a laptop asleep overnight, a single
  // skipped cron tick) doesn't false-positive — only a schedule that's
  // genuinely stopped running does.
  if (snapshotInfo?.newestSnapshotTime && presentPeriods.length > 0) {
    const newestMs = Date.parse(snapshotInfo.newestSnapshotTime);
    if (!Number.isNaN(newestMs)) {
      const ageDays = (Date.now() - newestMs) / MS_PER_DAY;
      const shortestPeriodDays = Math.min(...presentPeriods.map((p) => p.days));
      const staleThresholdDays = Math.max(shortestPeriodDays * 3, 1);
      if (ageDays > staleThresholdDays) {
        findings.push({
          id: `${backend}-newest-snapshot-stale`,
          severity: "warning",
          message:
            `The newest snapshot in this repository is about ${Math.floor(ageDays)} day(s) old, but the ` +
            `declared retention policy implies backups should land at least every ~${shortestPeriodDays} day(s). ` +
            `This usually means the schedule that runs your ${backend === "restic" ? "restic backup" : "borg create"} ` +
            `job stopped running (a broken cron/systemd timer, a sleeping machine) while this check's own ` +
            `verification kept passing against the last snapshot it could still see.`,
        });
      }
    }
  }

  // Rule: the OLDEST surviving snapshot is far older than the declared
  // policy's total retention span should allow, meaning prune isn't
  // actually removing anything — a config/permissions issue silently
  // no-op-ing `restic forget --prune`/`borg prune` while the backup step
  // (and this check's own pass/fail verification) keeps succeeding. Total
  // span = sum of (period days * count) across the present time-bearing
  // flags — e.g. "--keep-daily 7 --keep-weekly 4" implies roughly 7*1 +
  // 4*7 = 35 days' worth of snapshots should exist, not more. 2x that
  // total (rather than 3x, unlike the staleness check above) because this
  // is a coarser, slower-moving signal by nature — prune typically only
  // runs alongside backup, so a couple of legitimately-late prune cycles
  // shouldn't false-positive, but "the oldest snapshot is still there
  // after DOUBLE the policy's own implied lifetime" is a real, no longer
  // ambiguous signal that prune isn't taking effect.
  if (snapshotInfo?.oldestSnapshotTime && presentPeriods.length > 0) {
    const oldestMs = Date.parse(snapshotInfo.oldestSnapshotTime);
    if (!Number.isNaN(oldestMs)) {
      const ageDays = (Date.now() - oldestMs) / MS_PER_DAY;
      const totalSpanDays = presentPeriods.reduce((sum, { re, days }) => {
        const m = trimmed.match(re);
        const count = m ? Number(m[1]) : 0;
        return sum + days * count;
      }, 0);
      const pruneThresholdDays = totalSpanDays * 2;
      if (totalSpanDays > 0 && ageDays > pruneThresholdDays) {
        findings.push({
          id: `${backend}-prune-not-effective`,
          severity: "warning",
          message:
            `The oldest snapshot still in this repository is about ${Math.floor(ageDays)} day(s) old, but the ` +
            `declared retention policy should only be keeping roughly the last ${totalSpanDays} day(s) of ` +
            `snapshots. That means ${backend === "restic" ? "restic forget --prune" : "borg prune"} doesn't ` +
            `appear to actually be removing old snapshots — worth checking that the prune step is really ` +
            `running (and succeeding, not silently failing on a permissions or lock issue) alongside your ` +
            `backup job.`,
        });
      }
    }
  }

  return findings;
}

/**
 * Duplicati retention auditing — see the file comment above for the real,
 * verified correction (2026-07-25) to this file's earlier assumption:
 * Duplicati has no stored-policy-readback command, so like restic/Borg the
 * agent has to be TOLD its own retention flags (VESTAL_DUPLICATI_RETENTION_POLICY
 * — see agent/vestal-duplicati.sh), not introspect them.
 *
 * The rules themselves are deliberately NOT a copy of auditRetentionFlags(),
 * because a real test against a real Duplicati 2.3.0.4 repo showed its
 * zero-value semantics are the OPPOSITE of restic/Borg's: two real backups
 * run back to back against the same repo — one with `--keep-versions=2`,
 * one with `--keep-versions=0` — were compared via real `list-filesets`
 * output before and after. `--keep-versions=2` genuinely pruned 5 filesets
 * down to 2 (confirmed both via `list-filesets` and the backup's own real
 * "Deleting file ...dlist..." log lines). `--keep-versions=0` deleted
 * NOTHING (3 filesets in, 3 out) — confirmed again with `--keep-versions=-1`
 * on the same repo (4 filesets in, 4 out, matching Duplicati's own
 * documented "-1 means keep all versions" text). So for Duplicati,
 * `--keep-versions=0` is both the CLI's own real default AND means
 * "unlimited" (never prune by count) — copying restic/Borg's "declared
 * keep-count totals to zero = nothing protected = warning" rule verbatim
 * would have fired a warning on the SAFEST configuration (never deletes
 * anything) and said nothing about the actually risky one
 * (`--keep-versions=1`: exactly one version ever kept, a real single point
 * of failure). `--retention-policy`'s time-based pruning format (comma-
 * separated timeframe:interval pairs, e.g. "7D:0s,3M:1D,10Y:2M") is
 * confirmed real from `duplicati-cli help retention-policy` output, but its
 * actual pruning behavior was NOT independently re-verified the way
 * `--keep-versions` was — that only plays out across real day/month/year
 * boundaries, not observable in one sitting — so it's only used here to
 * recognize the flag's presence, the same narrow scope
 * `auditRetentionFlags()` already uses for restic/Borg's own flags.
 */
const DUPLICATI_KEEP_VERSIONS_RE = /--keep-versions[= ]\s*(-?\d+)/;
const DUPLICATI_RETENTION_POLICY_RE = /--retention-policy[= ]\s*(\S+)/;
const DUPLICATI_KEEP_TIME_RE = /--keep-time[= ]\s*(\S+)/;

export function auditDuplicatiRetention(rawFlags: string): AuditFinding[] {
  const trimmed = rawFlags.trim();
  const keepVersionsMatch = trimmed.match(DUPLICATI_KEEP_VERSIONS_RE);
  const hasRetentionPolicy = DUPLICATI_RETENTION_POLICY_RE.test(trimmed);
  const hasKeepTime = DUPLICATI_KEEP_TIME_RE.test(trimmed);

  // Same typo/wrong-tool guard as auditRetentionFlags(), and the same
  // empty-string handling (an empty/whitespace-only string matches none of
  // the three regexes above, same as if nothing were recognized at all).
  if (!keepVersionsMatch && !hasRetentionPolicy && !hasKeepTime) {
    return [
      {
        id: "duplicati-no-recognized-retention-flags",
        severity: "warning",
        message:
          "Vestal couldn't find a recognized retention flag (--keep-versions, --retention-policy, or " +
          "--keep-time) in the policy this check declared. Either nothing is actually pruning old versions, or " +
          "the flags are spelled differently than what was reported here — worth double-checking your " +
          "duplicati-cli backup command.",
      },
    ];
  }

  const findings: AuditFinding[] = [];
  const keepVersions = keepVersionsMatch ? Number(keepVersionsMatch[1]) : null;

  // Real, verified footgun (see this function's comment): keeping exactly
  // one version means a single corrupted, encrypted, or otherwise bad
  // backup run silently becomes the ONLY recovery point available, with no
  // earlier version to fall back to.
  if (keepVersions === 1) {
    findings.push({
      id: "duplicati-single-version-retention",
      severity: "warning",
      message:
        "--keep-versions=1 means only the single most recent backup version is ever kept — if that run " +
        "captures corrupted, encrypted, or otherwise bad data, there is no earlier version left to restore " +
        "instead.",
    });
  }

  // Real, verified (not guessed, see this function's comment): an explicit
  // --keep-versions of 0 or -1, with no --retention-policy/--keep-time
  // alongside it, means every version is kept forever — not a data-safety
  // risk, the opposite in fact, but worth surfacing since storage use then
  // grows without bound over time.
  if ((keepVersions === 0 || keepVersions === -1) && !hasRetentionPolicy && !hasKeepTime) {
    findings.push({
      id: "duplicati-unbounded-retention",
      severity: "info",
      message:
        "No version limit is actually enforced for this check (--keep-versions is 0 or -1, no " +
        "--retention-policy or --keep-time set) — verified against a real Duplicati repo, this means every " +
        "backup version is kept forever. Nothing is at risk, but storage use will grow without bound over time.",
    });
  }

  return findings;
}
