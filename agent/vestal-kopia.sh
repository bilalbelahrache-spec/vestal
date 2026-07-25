#!/usr/bin/env bash
#
# Vestal verification agent for Kopia.
#
# Add this as a step AFTER your existing `kopia snapshot create` in
# whatever already runs it (cron, systemd timer, etc). It does not take a
# backup — it verifies that an existing, already-connected repository is
# actually sound, then reports pass/fail to Vestal so you get alerted the
# moment that stops being true, instead of the day you actually need the
# restore.
#
# Assumes the repository is already connected (`kopia repository connect`
# already run as part of your normal setup, same assumption the restic
# agent makes about RESTIC_REPOSITORY already being configured) — this
# script only verifies, it doesn't establish the connection itself.
#
# Written against Kopia 0.23+ CLI conventions — confirm flags against
# `kopia --help` on your installed version before relying on this in
# production, same caveat as the restic/Borg agents.
#
# ── A correctness-critical detail, found by testing against a real
# corrupted repository, not assumed ──────────────────────────────────────
# Kopia keeps a local on-disk cache of repository content. Verifying with
# a warm cache can silently PASS against corrupted remote data, because
# Kopia serves the (still-good) locally cached copy instead of actually
# re-reading the real repository storage — confirmed directly: the exact
# same `snapshot verify` command against the exact same hand-corrupted
# repository returned 0 errors with a warm cache, and correctly reported
# 2 real errors (`invalid checksum ... cipher: message authentication
# failed`) the moment the cache was cleared first. This script always
# points Kopia at a fresh, throwaway cache directory for that reason — a
# quieter cache-warmed pass here would defeat the entire point of this
# tool. Slower than reusing a cache, and that's the correct trade-off.
#
# Required environment variables:
#   KOPIA_CONFIG_PATH   - as usual, from your existing `kopia repository connect`
#   KOPIA_PASSWORD       - as usual (or however you already supply it)
#   VESTAL_PING_URL      - the ping URL for this check, from `POST /api/checks`
#
# Optional:
#   VESTAL_VERIFY_PERCENT - percentage of file data to actually download
#                             and cryptographically verify, e.g. "5". Slower
#                             than the default structural check, but this is
#                             the part that catches silent bit-rot /
#                             corrupted pack blobs — see the finding above.
#                             Unset = structural check only (fast, still
#                             catches missing/truncated packs, but NOT
#                             silent data corruption in existing packs).
#   VESTAL_DRILL_MODE     - set to any non-empty value to also run a real
#                             restore drill (see PRO_FEATURES_ROADMAP.md
#                             item 5): restores the globally most recent
#                             snapshot across every source in this repo into
#                             a FRESH `mktemp -d` directory (never a
#                             user-configured path, same "remove the wrong-
#                             place risk class entirely" reasoning as the
#                             restic agent's VESTAL_DRILL_MODE), times it,
#                             counts restored files against the snapshot's
#                             own recorded file count, then deletes the
#                             restored copy. Requires jq. Verified against a
#                             real local Kopia repo (0.23.1) — `kopia
#                             snapshot list --all --json`'s
#                             `.rootEntry.summ.files` is the field that
#                             matches an actual restored file count, and
#                             `kopia snapshot restore <snapshot-id>
#                             <target>` restores by ID directly, no source
#                             path needed (this script never runs `kopia
#                             snapshot create`, so it has no source path of
#                             its own to restore from otherwise).
#
set -euo pipefail

: "${KOPIA_CONFIG_PATH:?KOPIA_CONFIG_PATH must be set}"
: "${VESTAL_PING_URL:?VESTAL_PING_URL must be set}"

START_TIME=$(date +%s)
LOG=$(mktemp)
# Fresh cache per run, always — see the correctness note above. Reusing a
# persistent cache is exactly the mistake that hides real corruption.
FRESH_CACHE=$(mktemp -d)
export KOPIA_CACHE_DIRECTORY="$FRESH_CACHE"
trap 'rm -rf "$LOG" "$FRESH_CACHE"' EXIT

# --- failure reporting -----------------------------------------------------
# Same reasoning as the restic/Borg agents: anything past this point that
# goes wrong needs to reach Vestal as an explicit failure, not silence —
# silence looks like "the cron job never ran" (a slower, different alert),
# not "the repository is actually broken."
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

echo "== kopia repository status (reachable, connected) ==" | tee -a "$LOG"
kopia repository status 2>&1 | tee -a "$LOG"

echo "== kopia content verify (structural: missing/truncated packs) ==" | tee -a "$LOG"
kopia content verify 2>&1 | tee -a "$LOG"

if [[ -n "${VESTAL_VERIFY_PERCENT:-}" ]]; then
  echo "== kopia content verify --full --download-percent=${VESTAL_VERIFY_PERCENT} (actual data re-read + checksum) ==" | tee -a "$LOG"
  kopia content verify --full --download-percent="${VESTAL_VERIFY_PERCENT}" 2>&1 | tee -a "$LOG"

  echo "== kopia snapshot verify --verify-files-percent=${VESTAL_VERIFY_PERCENT} ==" | tee -a "$LOG"
  kopia snapshot verify --verify-files-percent="${VESTAL_VERIFY_PERCENT}" 2>&1 | tee -a "$LOG"
fi

# --- optional: ransomware/anomaly canary diff stats -------------------------
# Same feature as the restic agent's equivalent section (see PRO_FEATURES_
# ROADMAP.md item 1) — compares the two most recent snapshots and reports
# rough change volume so Vestal can flag a run that looks like mass file
# rewriting instead of normal incremental backup churn. Best-effort: needs
# jq and at least two snapshots; either missing just skips this section.
#
# Verified against a real local Kopia repo (0.23.1) with a genuine
# simulated ransomware event (mass rename to add a `.locked` extension,
# same test used to verify the restic agent's equivalent section): `kopia
# diff <old> <new>` prints per-file `added file`/`removed file` lines
# followed by a trailing JSON stats object (`.fileEntries.added/removed/
# modified`) — a rename shows up as an add+remove pair with `modified`
# staying at zero, the same restic behavior src/anomaly.ts is specifically
# tuned around, confirmed by the real output this test produced.
DIFF_STATS_ARGS=()
if command -v jq >/dev/null 2>&1; then
  SNAPSHOT_IDS=$(kopia snapshot list --all --json 2>/dev/null | jq -r '[.[]] | sort_by(.startTime) | .[-2:] | .[].id' 2>/dev/null || true)
  SNAPSHOT_COUNT=$(printf '%s\n' "$SNAPSHOT_IDS" | grep -c . || true)
  if [[ "$SNAPSHOT_COUNT" -eq 2 ]]; then
    OLD_SNAP=$(printf '%s\n' "$SNAPSHOT_IDS" | sed -n 1p)
    NEW_SNAP=$(printf '%s\n' "$SNAPSHOT_IDS" | sed -n 2p)
    DIFF_OUTPUT=$(kopia diff "$OLD_SNAP" "$NEW_SNAP" 2>/dev/null || true)
    DIFF_STATS_JSON=$(printf '%s\n' "$DIFF_OUTPUT" | tail -1)

    FILES_ADDED=$(printf '%s\n' "$DIFF_STATS_JSON" | jq -r '.fileEntries.added // 0' 2>/dev/null || echo 0)
    FILES_REMOVED=$(printf '%s\n' "$DIFF_STATS_JSON" | jq -r '.fileEntries.removed // 0' 2>/dev/null || echo 0)
    FILES_CHANGED=$(printf '%s\n' "$DIFF_STATS_JSON" | jq -r '.fileEntries.modified // 0' 2>/dev/null || echo 0)

    # Same rename-detection heuristic as the restic agent: an added path
    # whose name, minus its last extension, exactly matches a removed
    # path's full name is the classic "extension appended" ransomware
    # rename. Verified against the real diff output above.
    EXT_STATS_TMP=$(mktemp -d)
    printf '%s\n' "$DIFF_OUTPUT" | grep -E '^added file' | sed -E 's/^added file[[:space:]]+//' | sed -E 's/ \([0-9]+ bytes\)$//' | sed -E 's/\.[^.\/]+$//' | sort > "$EXT_STATS_TMP/added_stripped.txt"
    printf '%s\n' "$DIFF_OUTPUT" | grep -E '^removed file' | sed -E 's/^removed file[[:space:]]+//' | sed -E 's/ \([0-9]+ bytes\)$//' | sort > "$EXT_STATS_TMP/removed_raw.txt"
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
# Reports the current global policy to Vestal, which checks it against a
# small set of known footguns (see PRO_FEATURES_ROADMAP.md item 3 /
# src/audit-rules.ts) — e.g. retention set to zero, or file/directory read
# errors silently ignored instead of failing the snapshot. Best effort,
# same pattern as the restic agent's anomaly-canary section: requires jq
# (to safely wrap Kopia's own JSON output, not to parse it — it's passed
# through as-is), and just skips this section if jq isn't available. The
# real pass/fail verification above already ran and reported regardless.
if command -v jq >/dev/null 2>&1; then
  POLICY_JSON=$(kopia policy show --global --json 2>/dev/null || true)
  if [[ -n "$POLICY_JSON" ]]; then
    curl -fsS -m 15 \
      -H "content-type: application/json" \
      -d "$(jq -nc --argjson policy "$POLICY_JSON" '{kopia_policy: $policy}')" \
      "${VESTAL_PING_URL}/config-audit" >/dev/null || true
  fi
fi

# --- optional: restore drill (real RTO reporting) ---------------------------
# See PRO_FEATURES_ROADMAP.md item 5 and VESTAL_DRILL_MODE above. Reported
# to a separate /drill endpoint, not folded into this check's normal
# pass/fail — same reasoning as the restic agent. Runs inside an `if`
# condition, so a failing `kopia snapshot restore` doesn't trip `set -e` or
# the ERR trap above; the failure is caught and reported explicitly instead.
if [[ -n "${VESTAL_DRILL_MODE:-}" ]]; then
  if ! command -v jq >/dev/null 2>&1; then
    echo "Vestal: VESTAL_DRILL_MODE is set but jq isn't installed — skipping the restore drill." | tee -a "$LOG"
  else
    echo "== restore drill: restoring the most recent snapshot to a throwaway directory ==" | tee -a "$LOG"
    DRILL_START=$(date +%s)
    DRILL_DIR=$(mktemp -d)
    DRILL_LOG=$(mktemp)
    DRILL_STATUS="pass"
    DRILL_MESSAGE=""
    FILES_RESTORED=""
    LATEST_SNAPSHOT=$(kopia snapshot list --all --json 2>/dev/null | jq -c '[.[]] | sort_by(.startTime) | last // empty')

    if [[ -z "$LATEST_SNAPSHOT" ]]; then
      DRILL_STATUS="fail"
      DRILL_MESSAGE="no snapshots found in this repository to restore"
    else
      LATEST_ID=$(echo "$LATEST_SNAPSHOT" | jq -r '.id')
      FILES_EXPECTED=$(echo "$LATEST_SNAPSHOT" | jq -r '.rootEntry.summ.files // empty')
      if kopia snapshot restore "$LATEST_ID" "$DRILL_DIR" >"$DRILL_LOG" 2>&1; then
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
