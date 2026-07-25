#!/usr/bin/env bash
#
# Vestal verification agent for restic.
#
# Add this as a step AFTER your existing restic backup command in whatever
# already runs it (cron, systemd timer, etc). It does not take a backup —
# it verifies that an existing repository is actually sound, then reports
# pass/fail to Vestal so you get alerted the moment that stops being
# true, instead of the day you actually need the restore.
#
# Written against restic 0.17+ CLI conventions. `restic check`'s flags in
# particular are worth confirming against `restic version` / `restic check
# --help` on your installed version before relying on this in production —
# don't take the exact flag spelling here on faith.
#
# Required environment variables (standard restic ones, plus one of ours):
#   RESTIC_REPOSITORY        - as usual
#   RESTIC_PASSWORD (or RESTIC_PASSWORD_FILE / RESTIC_PASSWORD_COMMAND)
#   VESTAL_PING_URL          - the ping URL for this check, from `POST /api/checks`
#
# Optional:
#   VESTAL_READ_DATA_SUBSET  - percentage of data to actually re-read
#                                    and verify, e.g. "5%". Slower than a
#                                    plain metadata check, but this is the
#                                    part that catches silent bit-rot /
#                                    corrupted pack files that a metadata-
#                                    only check will not. Unset = metadata
#                                    check only (fast, still catches a lot,
#                                    but not everything — see README).
#   VESTAL_DRILL_MODE        - set to any non-empty value to also run a
#                                    real restore drill (see PRO_FEATURES_
#                                    ROADMAP.md item 5): restores the latest
#                                    snapshot into a FRESH `mktemp -d`
#                                    directory (never a user-configured
#                                    path — see the note below for why),
#                                    times it, counts restored files against
#                                    `restic ls latest`, then deletes the
#                                    restored copy. Requires jq (to parse
#                                    `restic ls latest --json`). Reports
#                                    pass/fail + duration to a distinct
#                                    /drill endpoint, alerted on separately
#                                    from the normal pass/fail check.
#
#   VESTAL_RETENTION_POLICY  - the exact `--keep-*` flags this repository's
#                                    OWN prune job already uses (e.g. "--keep-
#                                    daily 7 --keep-weekly 4 --keep-monthly
#                                    6"), reported to Vestal's config auditor
#                                    (see PRO_FEATURES_ROADMAP.md item 3 /
#                                    src/audit-rules.ts). restic has no
#                                    stored retention policy to read back —
#                                    it's just CLI flags at `restic forget`
#                                    time — so this has to be told, not
#                                    discovered. Best-effort like the anomaly
#                                    canary above: unset just skips this
#                                    section entirely.
#
#                                    2026-07-25: this section now also
#                                    reports the repository's newest and
#                                    oldest snapshot timestamps alongside the
#                                    declared policy (from `restic snapshots
#                                    --json`, the same real, already-used
#                                    field the anomaly-canary section above
#                                    reads .time from), so Vestal's auditor
#                                    can flag a schedule that's silently
#                                    stopped running (newest snapshot far
#                                    older than the policy's own cadence
#                                    implies) or a prune step that's silently
#                                    not taking effect (oldest snapshot far
#                                    outliving the policy's total retention
#                                    span) — see auditRetentionFlags()'s
#                                    comment in src/audit-rules.ts for the
#                                    exact thresholds. Verified against a
#                                    real local restic 0.19.1 repo
#                                    (two real snapshots) that `restic
#                                    snapshots --json | jq -r 'sort_by(.time)
#                                    | .[0].time // empty, .[-1].time //
#                                    empty'` really does return the oldest
#                                    then newest ISO-8601 timestamp, in that
#                                    order, from real output — not guessed at
#                                    from docs.
#
# ── Deliberate deviation from the original plan, on purpose ────────────
# The plan called for a user-configured drill target path, specifically to
# avoid ever restoring into the wrong place. This script goes further and
# removes that risk class entirely instead of just documenting it: the
# restore target is ALWAYS a fresh `mktemp -d` this script creates and
# deletes itself, every run — there is no VESTAL_DRILL_TARGET variable to
# mistype or leave pointed at something important. The only way this could
# restore into a meaningful location is if `mktemp -d` itself did, which
# would be a much bigger problem than this script.
#
set -euo pipefail

: "${RESTIC_REPOSITORY:?RESTIC_REPOSITORY must be set}"
: "${VESTAL_PING_URL:?VESTAL_PING_URL must be set}"

START_TIME=$(date +%s)
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

# --- failure reporting -----------------------------------------------------
# Anything that goes wrong past this point — a bad exit code, a timeout,
# this script itself crashing — needs to reach Vestal as a failure,
# not as silence. Silence looks identical to "the cron job never ran,"
# which is a *different* alert with a *slower* default grace period; an
# explicit /fail ping is faster and more specific, so we send both: an
# explicit fail signal now, in addition to whatever the missed-check-in
# detector would eventually catch anyway.
report_failure() {
  local duration=$(( $(date +%s) - START_TIME ))
  local tail_of_log
  tail_of_log=$(tail -c 500 "$LOG" 2>/dev/null | sed 's/[^[:print:]\t]//g')
  # -G is load-bearing, not cosmetic: without it, curl sends --data-urlencode
  # fields as a POST body, but the ping endpoint only ever reads the URL
  # query string (see src/index.ts's handlePing) — confirmed by testing
  # against a real running instance (2026-07-24) that message/duration_ms
  # silently came through as null without -G, even though curl itself
  # reported success. -G keeps curl on GET and puts these fields in the
  # query string instead, which is what actually gets read.
  curl -fsS -G -m 15 \
    --data-urlencode "message=${tail_of_log}" \
    --data-urlencode "duration_ms=$((duration * 1000))" \
    "${VESTAL_PING_URL}/fail" >/dev/null || true
}
trap 'report_failure' ERR

# --- optional: signal the run has started ----------------------------------
curl -fsS -m 15 "${VESTAL_PING_URL}/start" >/dev/null || true

# --- the actual verification -------------------------------------------------

echo "== restic check (repository structure + metadata) ==" | tee -a "$LOG"
restic check 2>&1 | tee -a "$LOG"

if [[ -n "${VESTAL_READ_DATA_SUBSET:-}" ]]; then
  echo "== restic check --read-data-subset=${VESTAL_READ_DATA_SUBSET} (actual data re-read) ==" | tee -a "$LOG"
  restic check --read-data-subset="${VESTAL_READ_DATA_SUBSET}" 2>&1 | tee -a "$LOG"
fi

# --- optional: ransomware/anomaly canary diff stats -------------------------
# Compares the two most recent snapshots and reports rough change volume so
# Vestal can flag a run that looks like mass file rewriting (ransomware,
# accidental bulk deletion) instead of normal incremental backup churn —
# see PRO_FEATURES_ROADMAP.md item 1. Best-effort by design: requires jq
# (to parse `restic snapshots --json` without a fragile text-format parse)
# and at least two existing snapshots. Either missing just skips this
# section entirely — the real pass/fail verification above already ran and
# reported regardless; this is a strict addition, never a requirement.
#
# Verified against a real restic repo (0.19.1) with a genuine simulated
# ransomware event (mass rename to add a `.locked` extension): restic
# represents a rename as a DELETE of the old path plus an ADD of the new
# one, not a "changed" file — so `files_changed` alone stays at zero for
# exactly the case this exists to catch. The extension-change heuristic
# below specifically catches the "same file, new extension appended"
# pattern (photo.jpg -> photo.jpg.locked), which covers most real-world
# ransomware naming behavior, but not every possible rename shape — see
# src/anomaly.ts for how ext_change_count and pure volume are weighed
# differently server-side.
DIFF_STATS_ARGS=()
if command -v jq >/dev/null 2>&1; then
  SNAPSHOT_IDS=$(restic snapshots --json 2>/dev/null | jq -r 'sort_by(.time) | .[-2:] | .[].short_id' 2>/dev/null || true)
  SNAPSHOT_COUNT=$(printf '%s\n' "$SNAPSHOT_IDS" | grep -c . || true)
  if [[ "$SNAPSHOT_COUNT" -eq 2 ]]; then
    OLD_SNAP=$(printf '%s\n' "$SNAPSHOT_IDS" | sed -n 1p)
    NEW_SNAP=$(printf '%s\n' "$SNAPSHOT_IDS" | sed -n 2p)
    DIFF_OUTPUT=$(restic diff "$OLD_SNAP" "$NEW_SNAP" 2>/dev/null || true)

    FILES_ADDED=$(printf '%s\n' "$DIFF_OUTPUT" | grep -F 'Files:' | sed -E 's/.*Files:[[:space:]]+([0-9]+) new.*/\1/')
    FILES_REMOVED=$(printf '%s\n' "$DIFF_OUTPUT" | grep -F 'Files:' | sed -E 's/.*new,[[:space:]]+([0-9]+) removed.*/\1/')
    FILES_CHANGED=$(printf '%s\n' "$DIFF_OUTPUT" | grep -F 'Files:' | sed -E 's/.*removed,[[:space:]]+([0-9]+) changed.*/\1/')

    # Rough extension-change heuristic: an added path whose name, minus its
    # LAST extension, exactly matches a removed path's full name is the
    # classic "extension appended" ransomware rename (photo.jpg becomes
    # photo.jpg.locked: strip ".locked" from the added path and it equals
    # the removed path exactly). A `comm` of two sorted lists rather than a
    # nested loop, so this stays fast even on a large changeset.
    EXT_STATS_TMP=$(mktemp -d)
    printf '%s\n' "$DIFF_OUTPUT" | grep -E '^\+' | sed -E 's/^\+[[:space:]]+//' | sed -E 's/\.[^.\/]+$//' | sort > "$EXT_STATS_TMP/added_stripped.txt"
    printf '%s\n' "$DIFF_OUTPUT" | grep -E '^-' | sed -E 's/^-[[:space:]]+//' | sort > "$EXT_STATS_TMP/removed_raw.txt"
    EXT_CHANGE_COUNT=$(comm -12 "$EXT_STATS_TMP/added_stripped.txt" "$EXT_STATS_TMP/removed_raw.txt" | grep -c .)
    rm -rf "$EXT_STATS_TMP"

    DIFF_STATS_ARGS=(
      --data-urlencode "files_changed=${FILES_CHANGED:-0}"
      --data-urlencode "files_added=${FILES_ADDED:-0}"
      --data-urlencode "files_removed=${FILES_REMOVED:-0}"
      --data-urlencode "ext_change_count=${EXT_CHANGE_COUNT:-0}"
    )
  fi
fi

# --- optional: config & retention policy audit ------------------------------
# See PRO_FEATURES_ROADMAP.md item 3 and the VESTAL_RETENTION_POLICY note
# above. Best-effort, same pattern as the Kopia agent's equivalent section
# — requires jq (to safely JSON-encode an arbitrary flag string, same
# reason the Kopia agent uses jq rather than hand-built JSON), and just
# skips this section if jq isn't available.
if [[ -n "${VESTAL_RETENTION_POLICY:-}" ]] && command -v jq >/dev/null 2>&1; then
  # Oldest/newest snapshot timestamps for the stale-schedule / prune-not-
  # effective rules (see src/audit-rules.ts). Best-effort within an
  # already-best-effort section: `restic snapshots --json` failing, or
  # returning zero snapshots, just leaves both variables empty, which the
  # server treats as "skip those two rules" (same as the flags above), not
  # as an error.
  SNAPSHOT_TIMES=$(restic snapshots --json 2>/dev/null | jq -r 'sort_by(.time) | .[0].time // empty, .[-1].time // empty' 2>/dev/null || true)
  OLDEST_SNAPSHOT_TIME=$(printf '%s\n' "$SNAPSHOT_TIMES" | sed -n 1p)
  NEWEST_SNAPSHOT_TIME=$(printf '%s\n' "$SNAPSHOT_TIMES" | sed -n 2p)
  curl -fsS -m 15 \
    -H "content-type: application/json" \
    -d "$(jq -nc --arg policy "$VESTAL_RETENTION_POLICY" --arg newest "$NEWEST_SNAPSHOT_TIME" --arg oldest "$OLDEST_SNAPSHOT_TIME" \
      '{retention_policy: $policy, newest_snapshot_time: $newest, oldest_snapshot_time: $oldest}')" \
    "${VESTAL_PING_URL}/config-audit" >/dev/null || true
fi

# --- optional: restore drill (real RTO reporting) ---------------------------
# See PRO_FEATURES_ROADMAP.md item 5 and the note above VESTAL_DRILL_MODE.
# Reported to a SEPARATE /drill endpoint, not folded into this check's
# normal pass/fail — a slow or failed drill is a distinct, more urgent
# signal ("a real restore didn't work") from a metadata-check failure, and
# conflating them would let one silently overwrite the other. Because this
# runs inside an `if` condition, a failing `restic restore` here does NOT
# trip `set -e` or the ERR trap above (bash exempts commands used as an if
# condition from both) — the drill failure is caught and reported
# explicitly below instead of accidentally failing the whole script.
if [[ -n "${VESTAL_DRILL_MODE:-}" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "Vestal: VESTAL_DRILL_MODE is set but jq isn't installed — skipping the restore drill." | tee -a "$LOG"
  else
    echo "== restore drill: restoring latest snapshot to a throwaway directory ==" | tee -a "$LOG"
    DRILL_START=$(date +%s)
    DRILL_DIR=$(mktemp -d)
    DRILL_LOG=$(mktemp)
    DRILL_STATUS="pass"
    DRILL_MESSAGE=""
    FILES_RESTORED=""
    FILES_EXPECTED=$(restic ls latest --json 2>/dev/null | jq -s 'map(select(.type=="file")) | length' 2>/dev/null || echo "")

    if restic restore latest --target "$DRILL_DIR" >"$DRILL_LOG" 2>&1; then
      FILES_RESTORED=$(find "$DRILL_DIR" -type f | wc -l | tr -d ' ')
    else
      DRILL_STATUS="fail"
      DRILL_MESSAGE=$(tail -c 500 "$DRILL_LOG" 2>/dev/null | sed 's/[^[:print:]\t]//g')
    fi
    DRILL_DURATION_MS=$(( ($(date +%s) - DRILL_START) * 1000 ))
    rm -rf "$DRILL_DIR" "$DRILL_LOG"

    DRILL_ARGS=(--data-urlencode "status=${DRILL_STATUS}" --data-urlencode "duration_ms=${DRILL_DURATION_MS}")
    [[ -n "$FILES_RESTORED" ]] && DRILL_ARGS+=(--data-urlencode "files_restored=${FILES_RESTORED}")
    [[ -n "$FILES_EXPECTED" ]] && DRILL_ARGS+=(--data-urlencode "files_expected=${FILES_EXPECTED}")
    [[ -n "$DRILL_MESSAGE" ]] && DRILL_ARGS+=(--data-urlencode "message=${DRILL_MESSAGE}")
    curl -fsS -G -m 30 "${DRILL_ARGS[@]}" "${VESTAL_PING_URL}/drill" >/dev/null || true

    if [[ "$DRILL_STATUS" == "pass" ]]; then
      echo "Vestal: restore drill passed (${FILES_RESTORED:-?} files, $((DRILL_DURATION_MS / 1000))s)." | tee -a "$LOG"
    else
      echo "Vestal: restore drill FAILED — reported separately, does not fail this check's normal ping." | tee -a "$LOG"
    fi
  fi
fi

# --- report success ----------------------------------------------------------
DURATION=$(( $(date +%s) - START_TIME ))
SUMMARY=$(tail -c 500 "$LOG" | sed 's/[^[:print:]\t]//g')

curl -fsS -G -m 15 \
  --data-urlencode "message=${SUMMARY}" \
  --data-urlencode "duration_ms=$((DURATION * 1000))" \
  "${DIFF_STATS_ARGS[@]}" \
  "${VESTAL_PING_URL}" >/dev/null

echo "Vestal: verification passed, ping sent (${DURATION}s)."
