#!/usr/bin/env bash
#
# Vestal verification agent for Duplicati.
#
# Add this as a step AFTER your existing `duplicati-cli backup` in
# whatever already runs it (cron, systemd timer, etc). It does not take a
# backup — it verifies that an existing backup target is actually sound,
# then reports pass/fail to Vestal so you get alerted the moment that
# stops being true, instead of the day you actually need the restore.
#
# Written against Duplicati 2.3+ CLI conventions (`Duplicati.CommandLine`
# on Windows, `duplicati-cli` on Linux/macOS) — confirm flags against
# `duplicati-cli help test` on your installed version before relying on
# this in production, same caveat as the other agents.
#
# A real operational gotcha, found by testing against a real corrupted
# backup, not assumed: on a genuine hash-mismatch failure, `test` retries
# the download several times before giving up, which can take minutes
# per failed sample rather than failing fast — confirmed directly (a run
# against a hand-corrupted file took long enough to exceed a 30s timeout
# before completing). `--number-of-retries=0` below avoids turning "the
# backup is broken" into "the verification script hangs," which matters
# for anything running this on a schedule.
#
# Required environment variables:
#   VESTAL_DUPLICATI_TARGET      - the backup's storage URL, e.g.
#                                    file:///path/to/repo or a real backend URL
#   VESTAL_DUPLICATI_PASSPHRASE  - the backup's encryption passphrase
#   VESTAL_PING_URL              - the ping URL for this check, from `POST /api/checks`
#
# Optional:
#   VESTAL_DUPLICATI_CLI       - path to the Duplicati CLI binary if it's
#                                    not on PATH (e.g. on Windows:
#                                    "/c/Program Files/Duplicati 2/Duplicati.CommandLine.exe").
#                                    Defaults to "duplicati-cli".
#   VESTAL_VERIFY_SAMPLES      - how many remote file samples to download
#                                    and hash-verify. Defaults to 1 (fast,
#                                    still catches a corrupted/missing
#                                    remote file, just not necessarily
#                                    THIS one). Set to "all" for a full,
#                                    slower verification of every remote
#                                    file — the check that actually proves
#                                    the whole backup, not a sample of it.
#   VESTAL_DUPLICATI_RETENTION_POLICY - the exact `--keep-versions`/
#                                    `--retention-policy`/`--keep-time`
#                                    flag(s) this target's OWN `backup` job
#                                    already uses, reported to Vestal's
#                                    config auditor (see PRO_FEATURES_
#                                    ROADMAP.md item 3 / src/audit-rules.ts's
#                                    auditDuplicatiRetention()). Duplicati
#                                    was assumed to store a readable policy
#                                    like Kopia does — checked for real
#                                    against a real 2.3.0.4 install
#                                    (2026-07-25) and that's wrong: every
#                                    `duplicati-cli help <topic>` command was
#                                    enumerated and none of them read back a
#                                    previously-used retention flag.
#                                    Retention is CLI-flags-only at `backup`
#                                    time, exactly like restic/Borg, so this
#                                    has to be told, not discovered. Unset
#                                    just skips this section entirely.
#   VESTAL_DRILL_MODE          - set to any non-empty value to also run a
#                                    real restore drill (see PRO_FEATURES_
#                                    ROADMAP.md item 5): restores the most
#                                    recent backup version into a FRESH
#                                    `mktemp -d` directory via
#                                    `--restore-path`, never a user-
#                                    configured path (same reasoning as the
#                                    other three agents' VESTAL_DRILL_MODE).
#
#                                    Independently verified for real
#                                    2026-07-25 against a real local
#                                    Duplicati 2.3.0.4 repo (a real Windows
#                                    install, `file://` target, two backup
#                                    versions): `restore` with exactly the
#                                    flags below (`--restore-path`,
#                                    `--overwrite=true`,
#                                    `--number-of-retries=0`) restored every
#                                    file correctly (29/29). The narrower-
#                                    scope caveat that used to be here (no
#                                    expected-file-count check) is now
#                                    fixed: FILES_EXPECTED comes from
#                                    `duplicati-cli find <storage-URL>` with
#                                    NO filename argument (distinct from
#                                    `list-filesets`, see the real finding
#                                    below), matching the other three
#                                    agents' `files_expected` field. A real,
#                                    load-bearing finding along the way:
#                                    `list-filesets`' own per-version
#                                    "(N files, ...)" annotation counts
#                                    DIRECTORY entries as "files" too (a
#                                    repo with 29 real files and 2
#                                    directories reports "31 files" via
#                                    `list-filesets`), which would have
#                                    produced a false expected/restored
#                                    mismatch on every single drill.
#                                    `find <storage-URL>` with no filename
#                                    argument reports the exact same
#                                    per-version listing but its own "(N
#                                    files, ...)" count genuinely excludes
#                                    directories (confirmed: 29, exactly
#                                    matching the real restored file count)
#                                    — that's the one actually used below.
#
#   VESTAL_DUPLICATI_CLI's note about confirming flags against your
#   installed version still applies to everything above; `--restore-path`,
#   `--overwrite`, `--number-of-retries`, `compare`, `find`, and
#   `list-filesets` are all real, documented commands/flags, not invented,
#   but exact output formatting is worth spot-checking after a Duplicati
#   version upgrade.
#
set -euo pipefail

: "${VESTAL_DUPLICATI_TARGET:?VESTAL_DUPLICATI_TARGET must be set}"
: "${VESTAL_DUPLICATI_PASSPHRASE:?VESTAL_DUPLICATI_PASSPHRASE must be set}"
: "${VESTAL_PING_URL:?VESTAL_PING_URL must be set}"

DUPLICATI_CLI="${VESTAL_DUPLICATI_CLI:-duplicati-cli}"
SAMPLES="${VESTAL_VERIFY_SAMPLES:-1}"

START_TIME=$(date +%s)
LOG=$(mktemp)
trap 'rm -f "$LOG"' EXIT

# --- failure reporting -----------------------------------------------------
# Same reasoning as the other agents: anything past this point that goes
# wrong needs to reach Vestal as an explicit failure, not silence.
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

echo "== duplicati-cli test (downloads real remote files, verifies recorded hashes) ==" | tee -a "$LOG"
# Real, load-bearing finding (2026-07-25): Duplicati's own documented exit
# codes (`duplicati-cli help returncodes`) are 0=Success, 1=Successful
# operation but no files changed, 2=Successful with warning(s), and only
# 3/50/100/200 are real failures. A REAL run of this exact command against
# a real repo returned exit code 1 (with "Examined 3 files and found no
# errors" printed) purely because there was nothing new to verify beyond
# the sampled files — under this script's original bare `set -e`, that
# benign, genuinely-successful exit code was silently reported to Vestal
# as a hard FAILURE every time, which would have meant near-constant false
# alerts in real use. `set +e`/`PIPESTATUS` here captures the real exit
# code so it can be checked against Duplicati's own documented scheme
# instead of bash's default "any nonzero is fatal" behavior.
#
# `trap - ERR` / restoring it after is load-bearing, not decorative: `set
# +e` only suppresses the shell EXITING on a failing command, it does NOT
# suppress the ERR trap itself from firing (confirmed directly — a plain
# `set +e; false; set -e` under this same trap still invoked it). Since
# `duplicati-cli test` sits in a pipeline with `tee`, and `pipefail` is on,
# its real exit code propagates to the pipeline's overall status, which
# still qualifies as an ERR-trap-firing event even under `set +e`. Without
# suppressing the trap here too, the benign exit-1/2 case above would have
# fired `report_failure` (sending a false `/fail` ping) despite the `if`
# check below correctly treating it as success — caught by directly testing
# this exact construct, not assumed from bash's documented trap-exemption
# rules (which only cover *conditional* contexts, not `set +e`).
trap - ERR
set +e
"$DUPLICATI_CLI" test "$VESTAL_DUPLICATI_TARGET" "$SAMPLES" \
  --passphrase="$VESTAL_DUPLICATI_PASSPHRASE" \
  --full-remote-verification=true \
  --number-of-retries=0 \
  2>&1 | tee -a "$LOG"
DUP_TEST_EXIT="${PIPESTATUS[0]}"
set -e
trap 'report_failure' ERR
if [[ "$DUP_TEST_EXIT" -ge 3 ]]; then
  echo "Vestal: duplicati-cli test exited ${DUP_TEST_EXIT} — a real failure per Duplicati's own return-code scheme (0-2 are all successful; 3/50/100/200 are not)." | tee -a "$LOG"
  # An explicit call IS needed here, unlike what an earlier version of this
  # comment claimed: directly tested that `exit N` does NOT re-fire the ERR
  # trap on its own in this bash (confirmed with a minimal repro — an ERR
  # trap that prints on firing stayed silent across a plain `exit 5`).
  # Without this explicit call, a genuine Duplicati failure here would exit
  # non-zero without ever sending Vestal a `/fail` ping, silently falling
  # through to the much slower generic missed-check-in detector instead of
  # the fast, specific failure alert every other agent script sends.
  report_failure
  exit "$DUP_TEST_EXIT"
fi

# --- optional: ransomware/anomaly canary diff stats -------------------------
# See PRO_FEATURES_ROADMAP.md item 1 and the equivalent section in
# agent/vestal-restic.sh/agent/vestal-kopia.sh (same field names, so
# server-side scoring in src/anomaly.ts works unchanged regardless of
# backend). No extra env var or jq dependency needed here — unlike restic's
# JSON-based snapshot listing, `duplicati-cli compare` is plain text and
# defaults to comparing the two most recent backup versions on its own.
# Best-effort by design, same as the other backends: fewer than two backup
# versions just skips this section.
#
# Verified against a REAL local Duplicati repo (2.3.0.4, 2026-07-25) with a
# genuine simulated ransomware event (mass rename appending `.locked`,
# same event used to verify the restic/Kopia sections): Duplicati ALSO
# represents a rename as a DELETE of the old path plus an ADD of the new
# one, not a "changed" file — confirmed both via `compare`'s own output
# (4 added entries, 4 deleted entries, 0 modified files, for 4 renamed
# files) AND via the real `backup` command's own summary line for that same
# run ("Files added: 4 / Files deleted: 4 / Files changed: 0"). Same
# extension-change heuristic as the restic agent (strip an added path's
# last extension and check it matches a removed path) correctly caught all
# 4 renames (ext_change_count=4) in the real test.
#
# Two more real findings that shaped the parsing below:
#   1. `compare`'s SUMMARY block ("Added files: N" / "Deleted files: N" /
#      "Modified files: N") only lists a line when that count is nonzero —
#      confirmed by a real 0-modified-files comparison, where "Modified
#      files:" was absent entirely while "Added files:"/"Deleted files:"
#      were both present. Every field below is defaulted to 0 to handle
#      this, same convention as the restic agent's own defaulting.
#   2. Without `--full-result`, the individual "+ path" / "- path" lines
#      get truncated ("... and 14 more") past a small count, even though
#      the SUMMARY totals stay accurate either way — confirmed with a real
#      25-file changeset. `--full-result` is used below because the
#      extension-change heuristic needs the actual path lists, not just the
#      totals.
DIFF_STATS_ARGS=()
FILESET_LIST=$("$DUPLICATI_CLI" find "$VESTAL_DUPLICATI_TARGET" --passphrase="$VESTAL_DUPLICATI_PASSPHRASE" 2>/dev/null || true)
FILESET_COUNT=$(printf '%s\n' "$FILESET_LIST" | grep -cE '^[0-9]+[[:space:]]*:' || true)
if [[ "$FILESET_COUNT" -ge 2 ]]; then
  COMPARE_OUTPUT=$("$DUPLICATI_CLI" compare "$VESTAL_DUPLICATI_TARGET" --full-result --passphrase="$VESTAL_DUPLICATI_PASSPHRASE" 2>/dev/null || true)

  # Real bug caught by actually running this against a real repo
  # (2026-07-25), not just reasoned about: `grep -F` (and `grep -c`, below)
  # exits 1 — a real failure under `set -euo pipefail` — when its pattern
  # simply isn't found, which is the ORDINARY case here whenever a count is
  # legitimately zero (see finding #1 above: Duplicati omits the whole
  # "Modified files:" line when that count is 0). The very first real test
  # run of this section (a pure rename event, 0 modified files) hit this
  # immediately: the script aborted and reported a false FAILURE to Vestal
  # even though `duplicati-cli test` and everything else had genuinely
  # succeeded. Every grep below that can legitimately match nothing now has
  # an explicit `|| true` guarding it.
  FILES_ADDED=$(printf '%s\n' "$COMPARE_OUTPUT" | grep -F 'Added files:' | sed -E 's/.*Added files:[[:space:]]*([0-9]+).*/\1/' || true)
  FILES_REMOVED=$(printf '%s\n' "$COMPARE_OUTPUT" | grep -F 'Deleted files:' | sed -E 's/.*Deleted files:[[:space:]]*([0-9]+).*/\1/' || true)
  FILES_CHANGED=$(printf '%s\n' "$COMPARE_OUTPUT" | grep -F 'Modified files:' | sed -E 's/.*Modified files:[[:space:]]*([0-9]+).*/\1/' || true)

  # Same rough extension-change heuristic as agent/vestal-restic.sh: an
  # added path whose name, minus its LAST extension, exactly matches a
  # removed path's full name. `compare --full-result`'s added/deleted
  # sections use "  + <path>" / "  - <path>" prefixes; the character class
  # below strips at either a forward or back slash so this works whether
  # Duplicati is run on Windows or Linux/macOS. Each pipeline also gets its
  # own `|| true` for the same real reason as above — a diff with zero
  # added (or zero removed) entries is a legitimate, real case (e.g. a
  # mass-deletion-only event), not a script bug.
  DUP_EXT_TMP=$(mktemp -d)
  printf '%s\n' "$COMPARE_OUTPUT" | grep -E '^[[:space:]]*\+ ' | sed -E 's/^[[:space:]]*\+[[:space:]]+//' | sed -E 's/\.[^./\\]+$//' | sort > "$DUP_EXT_TMP/added_stripped.txt" || true
  printf '%s\n' "$COMPARE_OUTPUT" | grep -E '^[[:space:]]*- ' | sed -E 's/^[[:space:]]*-[[:space:]]+//' | sort > "$DUP_EXT_TMP/removed_raw.txt" || true
  EXT_CHANGE_COUNT=$(comm -12 "$DUP_EXT_TMP/added_stripped.txt" "$DUP_EXT_TMP/removed_raw.txt" | grep -c . || true)
  rm -rf "$DUP_EXT_TMP"

  DIFF_STATS_ARGS=(
    --data-urlencode "files_changed=${FILES_CHANGED:-0}"
    --data-urlencode "files_added=${FILES_ADDED:-0}"
    --data-urlencode "files_removed=${FILES_REMOVED:-0}"
    --data-urlencode "ext_change_count=${EXT_CHANGE_COUNT:-0}"
  )
fi

# --- optional: config & retention policy audit ------------------------------
# See PRO_FEATURES_ROADMAP.md item 3, src/audit-rules.ts's
# auditDuplicatiRetention(), and the VESTAL_DUPLICATI_RETENTION_POLICY note
# above for why this is CLI-flags-only for Duplicati (like restic/Borg),
# not a stored policy to read back (like Kopia) — that was a real, verified
# correction to this project's earlier assumption. Same jq dependency and
# best-effort skip as the restic/Kopia agents' equivalent section (jq
# safely JSON-encodes an arbitrary flag string).
if [[ -n "${VESTAL_DUPLICATI_RETENTION_POLICY:-}" ]] && command -v jq >/dev/null 2>&1; then
  curl -fsS -m 15 \
    -H "content-type: application/json" \
    -d "$(jq -nc --arg policy "$VESTAL_DUPLICATI_RETENTION_POLICY" '{retention_policy: $policy}')" \
    "${VESTAL_PING_URL}/config-audit" >/dev/null || true
fi

# --- optional: restore drill (real RTO reporting) ---------------------------
# See VESTAL_DRILL_MODE above for the real 2026-07-25 verification and the
# list-filesets-vs-find finding that FILES_EXPECTED below is built on. -----
if [[ -n "${VESTAL_DRILL_MODE:-}" ]]; then
  echo "== restore drill: restoring the most recent version to a throwaway directory ==" | tee -a "$LOG"
  DRILL_START=$(date +%s)
  DRILL_DIR=$(mktemp -d)
  DRILL_LOG=$(mktemp)
  DRILL_STATUS="pass"
  DRILL_MESSAGE=""
  FILES_RESTORED=""

  # FILES_EXPECTED: reuses $FILESET_LIST from the diff-stats section above
  # (that call already ran unconditionally, listing every backup version —
  # no need for a second remote round-trip). Version "0" is always the
  # latest, matching what a plain `restore` with no --version defaults to.
  # Real, verified finding (see VESTAL_DRILL_MODE's comment above): this
  # deliberately uses `find`'s own per-version count, NOT `list-filesets`'
  # — `list-filesets` counts directory entries as "files" too, which would
  # under-restore-looking mismatch every drill by however many directories
  # the source tree has.
  FILES_EXPECTED=$(printf '%s\n' "$FILESET_LIST" | sed -n -E 's/^0[[:space:]]*:.*\(([0-9]+) files?,.*/\1/p' | head -n1)

  # Same real exit-code finding as the `test` command above applies here
  # too (Duplicati's return codes are global, not per-command): 0/1/2 are
  # all genuinely successful, only 3/50/100/200 are real failures, so the
  # actual numeric code is needed, not just pass/fail. Getting that WITHOUT
  # tripping the ERR trap (see the `test` command's comment above for why
  # `set +e` alone doesn't suppress it) needs the command to sit in an
  # `if`/`else` — bash's own documented ERR-trap exemption explicitly covers
  # "the test following the if... reserved word," confirmed directly against
  # this exact construct (an ERR trap that prints on firing stayed silent
  # here, while a bare `set +e; cmd; set -e` version of this same command
  # did fire it). `$?` inside the `else` branch is still the failing
  # command's real exit code, not lost by entering the branch.
  if "$DUPLICATI_CLI" restore "$VESTAL_DUPLICATI_TARGET" \
    --passphrase="$VESTAL_DUPLICATI_PASSPHRASE" \
    --restore-path="$DRILL_DIR" \
    --overwrite=true \
    --number-of-retries=0 \
    >"$DRILL_LOG" 2>&1; then
    DUP_RESTORE_EXIT=0
  else
    DUP_RESTORE_EXIT=$?
  fi

  if [[ "$DUP_RESTORE_EXIT" -lt 3 ]]; then
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

# --- report success ----------------------------------------------------------
DURATION=$(( $(date +%s) - START_TIME ))
SUMMARY=$(tail -c 500 "$LOG" | sed 's/[^[:print:]\t]//g')

curl -fsS -G -m 15 \
  --data-urlencode "message=${SUMMARY}" \
  --data-urlencode "duration_ms=$((DURATION * 1000))" \
  "${DIFF_STATS_ARGS[@]}" \
  "${VESTAL_PING_URL}" >/dev/null

echo "Vestal: verification passed, ping sent (${DURATION}s)."
