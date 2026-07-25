#!/usr/bin/env bash
#
# Vestal verification agent for BorgBackup.
#
# Add this as a step AFTER your existing borg backup command in whatever
# already runs it (cron, systemd timer, etc). It does not take a backup —
# it verifies that an existing repository is actually sound, then reports
# pass/fail to Vestal so you get alerted the moment that stops being
# true, instead of the day you actually need the restore.
#
# Written against Borg 1.4.x CLI conventions (verified against a real
# `borg check --help` while writing this, not from memory alone). Unlike
# restic, `borg check --verify-data` has no percentage-subset option — it's
# all-or-nothing, so there's no equivalent of restic's READ_DATA_SUBSET
# knob here; VESTAL_VERIFY_DATA is a plain on/off switch instead.
#
# Required environment variables (standard Borg ones, plus one of ours):
#   BORG_REPO                - as usual
#   BORG_PASSPHRASE (or BORG_PASSCOMMAND / BORG_PASSPHRASE_FD)
#   VESTAL_PING_URL          - the ping URL for this check, from `POST /api/checks`
#
# Optional:
#   VESTAL_VERIFY_DATA       - set to any non-empty value to also run
#                              `borg check --verify-data`, which decrypts
#                              and CRC-checks every data block in the
#                              repository — this is the part that catches
#                              silent bit-rot / corrupted chunks that a
#                              structural-only check will not. Slower than
#                              a plain check, and there's no percentage
#                              knob to make it cheaper (see above). Unset =
#                              structural check only (fast, still catches
#                              a lot, but not everything — see README).
#   VESTAL_RETENTION_POLICY - the exact `--keep-*` flags this repository's
#                              OWN prune job already uses (e.g. "--keep-
#                              daily 7 --keep-weekly 4"), reported to
#                              Vestal's config auditor (see PRO_FEATURES_
#                              ROADMAP.md item 3 / src/audit-rules.ts) —
#                              same reasoning as the restic agent's
#                              equivalent variable: Borg has no stored
#                              retention policy to read back, only CLI
#                              flags at prune time, so this has to be told,
#                              not discovered. Best-effort: requires jq,
#                              unset or missing jq just skips this section.
#
#                              2026-07-25: this section now also reports the
#                              repository's newest and oldest archive
#                              timestamps alongside the declared policy
#                              (`borg list REPO --json`'s `.archives[].time`
#                              — the same real field the anomaly-canary
#                              section above already reads, here over the
#                              FULL archive list rather than just the last
#                              two), so Vestal's auditor can flag a schedule
#                              that's silently stopped running or a prune
#                              step that's silently not taking effect — see
#                              auditRetentionFlags()'s comment in
#                              src/audit-rules.ts for the exact thresholds.
#                              Verified against a real local Borg 1.4.4
#                              repository (2026-07-25, two real archives)
#                              that `borg list REPO --json | jq -r
#                              '.archives | sort_by(.time) | .[0].time //
#                              empty, .[-1].time // empty'` really does
#                              return the oldest then newest ISO-8601
#                              timestamp, in that order, from real output.
#   VESTAL_DRILL_MODE       - set to any non-empty value to also run a real
#                              restore drill (see PRO_FEATURES_ROADMAP.md
#                              item 5): extracts the most recent archive
#                              into a FRESH `mktemp -d` directory (never a
#                              user-configured path — same "remove the
#                              wrong-place risk class entirely" reasoning
#                              as the restic/Kopia agents), times it, counts
#                              extracted files, then deletes the extracted
#                              copy. Requires jq.
#
#                              Verified against a real Borg 1.4.4 repository
#                              (2026-07-25, previously untested — no Borg
#                              install was available when this was first
#                              written). Every field this script reads was
#                              confirmed correct as-is, no code changes
#                              needed: `borg list REPO --json --last 1` really
#                              does return `.archives[0].archive`; `borg info
#                              REPO::ARCHIVE --json` really does return the
#                              expected file count at `.archives[0].stats.
#                              nfiles`; and `borg extract` genuinely has no
#                              `--target` flag and must be run with a `cd`
#                              into the drill directory first (confirmed the
#                              existing `(cd "$DRILL_DIR" && borg extract ...)`
#                              subshell is exactly right, restoring the
#                              archive's full relative path structure under
#                              it). A real drill against a 10-file archive
#                              restored all 10, with `find -type f` matching
#                              `nfiles` exactly.
#
set -euo pipefail

: "${BORG_REPO:?BORG_REPO must be set}"
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

echo "== borg check (repository + archive structure) ==" | tee -a "$LOG"
borg check "$BORG_REPO" 2>&1 | tee -a "$LOG"

if [[ -n "${VESTAL_VERIFY_DATA:-}" ]]; then
  echo "== borg check --verify-data (full cryptographic data verification) ==" | tee -a "$LOG"
  borg check --verify-data "$BORG_REPO" 2>&1 | tee -a "$LOG"
fi

# --- optional: ransomware/anomaly canary diff stats -------------------------
# Compares the two most recent archives and reports rough change volume so
# Vestal can flag a run that looks like mass file rewriting (ransomware,
# accidental bulk deletion) instead of normal incremental backup churn —
# see PRO_FEATURES_ROADMAP.md item 1. Best-effort by design, same pattern as
# the restic/Kopia agents' equivalent section: requires jq (to parse `borg
# diff --json-lines` output) and at least two existing archives. Either
# missing just skips this section entirely — the real pass/fail verification
# above already ran and reported regardless; this is a strict addition,
# never a requirement.
#
# Verified against a real Borg repo (1.4.4, 2026-07-25) with a genuine
# simulated ransomware event (mass rename to add a `.locked` extension):
# like restic, Borg represents a rename as an ADD of the new path plus a
# REMOVE of the old one, not a "modified" file (`borg diff --help`'s own
# "What is compared" section documents no separate "renamed" change type at
# all) — so `files_changed` stays at zero for exactly the case this exists
# to catch, same real finding restic's script already documents. The
# extension-change heuristic below is the same "strip the last extension off
# an added path and match it against a removed path" approach restic uses.
#
# Borg's `--json-lines` output shape is NOT restic's: it's one JSON object
# per changed PATH (not a single per-snapshot summary line), each with a
# "changes" array of typed sub-objects, e.g.
#   {"path": "data/photos/photo1.jpg.locked", "changes": [{"type": "added", "size": 25}]}
#   {"path": "data/photos", "changes": [{"type": "ctime", ...}, {"type": "mtime", ...}]}
# So instead of a `grep 'Files:' | sed` on a summary line, this counts paths
# whose "changes" array contains an EXACT type=="added"/"removed"/"modified"
# entry. That exactness was verified to matter, not just be defensive: a
# newly-added directory reports as type "added directory" (a distinct
# string — confirmed for real, and correctly produces files_added=0, not 1),
# and a directory whose own mtime/ctime shifted because a child changed
# reports as a path with ONLY "ctime"/"mtime" entries and no "added"/
# "removed"/"modified" at all. An exact (non-substring) type match on
# "added"/"removed"/"modified" naturally excludes both of those non-file-
# content cases.
DIFF_STATS_ARGS=()
if command -v jq >/dev/null 2>&1; then
  ARCHIVE_NAMES=$(borg list "$BORG_REPO" --json --last 2 2>/dev/null | jq -r '.archives | sort_by(.time) | .[].name' 2>/dev/null || true)
  ARCHIVE_COUNT=$(printf '%s\n' "$ARCHIVE_NAMES" | grep -c . || true)
  if [[ "$ARCHIVE_COUNT" -eq 2 ]]; then
    OLD_ARCHIVE=$(printf '%s\n' "$ARCHIVE_NAMES" | sed -n 1p)
    NEW_ARCHIVE=$(printf '%s\n' "$ARCHIVE_NAMES" | sed -n 2p)
    DIFF_JSON=$(borg diff "$BORG_REPO::$OLD_ARCHIVE" "$NEW_ARCHIVE" --json-lines 2>/dev/null || true)

    FILES_ADDED=$(printf '%s\n' "$DIFF_JSON" | jq -rc 'select(any(.changes[]?; .type=="added")) | .path' 2>/dev/null | grep -c . || true)
    FILES_REMOVED=$(printf '%s\n' "$DIFF_JSON" | jq -rc 'select(any(.changes[]?; .type=="removed")) | .path' 2>/dev/null | grep -c . || true)
    FILES_CHANGED=$(printf '%s\n' "$DIFF_JSON" | jq -rc 'select(any(.changes[]?; .type=="modified")) | .path' 2>/dev/null | grep -c . || true)

    # Same `comm` of two sorted lists as the restic/Kopia agents, for the
    # same reason: fast even on a large changeset, no nested loop.
    EXT_STATS_TMP=$(mktemp -d)
    printf '%s\n' "$DIFF_JSON" | jq -r 'select(any(.changes[]?; .type=="added")) | .path' 2>/dev/null | sed -E 's/\.[^.\/]+$//' | sort > "$EXT_STATS_TMP/added_stripped.txt"
    printf '%s\n' "$DIFF_JSON" | jq -r 'select(any(.changes[]?; .type=="removed")) | .path' 2>/dev/null | sort > "$EXT_STATS_TMP/removed_raw.txt"
    EXT_CHANGE_COUNT=$(comm -12 "$EXT_STATS_TMP/added_stripped.txt" "$EXT_STATS_TMP/removed_raw.txt" | grep -c . || true)
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
# See PRO_FEATURES_ROADMAP.md item 3 and VESTAL_RETENTION_POLICY above.
if [[ -n "${VESTAL_RETENTION_POLICY:-}" ]] && command -v jq >/dev/null 2>&1; then
  # Oldest/newest archive timestamps for the stale-schedule / prune-not-
  # effective rules (see src/audit-rules.ts) — same best-effort-within-
  # best-effort handling as the restic agent's equivalent section: a
  # failed/empty `borg list` just leaves both variables empty, which the
  # server treats as "skip those two rules," not an error.
  ARCHIVE_TIMES=$(borg list "$BORG_REPO" --json 2>/dev/null | jq -r '.archives | sort_by(.time) | .[0].time // empty, .[-1].time // empty' 2>/dev/null || true)
  OLDEST_SNAPSHOT_TIME=$(printf '%s\n' "$ARCHIVE_TIMES" | sed -n 1p)
  NEWEST_SNAPSHOT_TIME=$(printf '%s\n' "$ARCHIVE_TIMES" | sed -n 2p)
  curl -fsS -m 15 \
    -H "content-type: application/json" \
    -d "$(jq -nc --arg policy "$VESTAL_RETENTION_POLICY" --arg newest "$NEWEST_SNAPSHOT_TIME" --arg oldest "$OLDEST_SNAPSHOT_TIME" \
      '{retention_policy: $policy, newest_snapshot_time: $newest, oldest_snapshot_time: $oldest}')" \
    "${VESTAL_PING_URL}/config-audit" >/dev/null || true
fi

# --- optional: restore drill (real RTO reporting) — verified against a real
# Borg repo, see the VESTAL_DRILL_MODE comment above. ------------------------
if [[ -n "${VESTAL_DRILL_MODE:-}" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "Vestal: VESTAL_DRILL_MODE is set but jq isn't installed — skipping the restore drill." | tee -a "$LOG"
  else
    echo "== restore drill: extracting the most recent archive to a throwaway directory ==" | tee -a "$LOG"
    DRILL_START=$(date +%s)
    DRILL_DIR=$(mktemp -d)
    DRILL_LOG=$(mktemp)
    DRILL_STATUS="pass"
    DRILL_MESSAGE=""
    FILES_RESTORED=""
    LATEST_ARCHIVE=$(borg list "$BORG_REPO" --json --last 1 2>/dev/null | jq -r '.archives[0].archive // empty')

    if [[ -z "$LATEST_ARCHIVE" ]]; then
      DRILL_STATUS="fail"
      DRILL_MESSAGE="no archives found in this repository to restore"
    else
      FILES_EXPECTED=$(borg info "$BORG_REPO::$LATEST_ARCHIVE" --json 2>/dev/null | jq -r '.archives[0].stats.nfiles // empty')
      # borg extract has no --target flag — it always extracts relative to
      # the current directory, so the cd into $DRILL_DIR (and back out
      # afterward) is load-bearing, not stylistic.
      if (cd "$DRILL_DIR" && borg extract "$BORG_REPO::$LATEST_ARCHIVE") >"$DRILL_LOG" 2>&1; then
        FILES_RESTORED=$(find "$DRILL_DIR" -type f | wc -l | tr -d ' ')
      else
        DRILL_STATUS="fail"
        DRILL_MESSAGE=$(tail -c 500 "$DRILL_LOG" 2>/dev/null | sed 's/[^[:print:]\t]//g')
      fi
    fi
    DRILL_DURATION_MS=$(( ($(date +%s) - DRILL_START) * 1000 ))
    rm -rf "$DRILL_DIR" "$DRILL_LOG"

    DRILL_ARGS=(--data-urlencode "status=${DRILL_STATUS}" --data-urlencode "duration_ms=${DRILL_DURATION_MS}")
    [[ -n "$FILES_RESTORED" ]] && DRILL_ARGS+=(--data-urlencode "files_restored=${FILES_RESTORED}")
    [[ -n "${FILES_EXPECTED:-}" ]] && DRILL_ARGS+=(--data-urlencode "files_expected=${FILES_EXPECTED}")
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
