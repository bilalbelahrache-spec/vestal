#!/usr/bin/env bash
#
# Vestal archive integrity monitor agent — bit-rot detection for cold/
# archival data (photo libraries, media collections) independent of any
# backup tool. See PRO_FEATURES_ROADMAP.md item 2.
#
# Unlike the restic/Borg/Kopia/Duplicati agents, this doesn't verify a
# backup — it periodically re-hashes a directory you designate and reports
# the full manifest to Vestal, which diffs it against what it saw last
# time and flags any file whose CONTENT changed without a matching
# size/modification-time change: that combination is the fingerprint of
# silent disk corruption, not an intentional edit (a real edit almost
# always changes the file's size and/or mtime along with its content).
#
# Required environment variables:
#   VESTAL_ARCHIVE_PATH   - directory to walk and hash (recursive)
#   VESTAL_PING_URL       - the ping URL for this check. The check must be
#                           created with backend "archive" (via the
#                           dashboard, or POST /api/checks with
#                           "backend": "archive") — this agent's sync
#                           endpoint rejects any other backend.
#
# Required tool: jq — not optional here (unlike the restic agent's
# anomaly-canary section), since this script's entire upload IS a JSON
# document and hand-rolling JSON string escaping for arbitrary file paths
# in bash is exactly the kind of thing that breaks on a real filename
# (spaces, quotes, unicode) sooner or later.
#
# Hash algorithm: picks the fastest available of b3sum (BLAKE3) > xxhsum
# (xxHash) > sha256sum (slower, but present on essentially every system,
# so it's the universal fallback). Whichever one is used, it's used
# consistently for THIS check across runs — a manifest is only ever
# diffed against its own prior sync, never another check's, so different
# checks (or different users) can use different algorithms with no
# cross-compatibility issue.
set -euo pipefail

: "${VESTAL_ARCHIVE_PATH:?VESTAL_ARCHIVE_PATH must be set}"
: "${VESTAL_PING_URL:?VESTAL_PING_URL must be set}"

if ! command -v jq >/dev/null 2>&1; then
  echo "Vestal: jq is required for the archive integrity agent (safe JSON construction for arbitrary file paths) — install it and re-run." >&2
  exit 1
fi

# Strip any trailing slash so the later prefix-stripping below produces a
# clean relative path (VESTAL_ARCHIVE_PATH + "/" + "/" would otherwise not
# match what `find` actually returns).
VESTAL_ARCHIVE_PATH="${VESTAL_ARCHIVE_PATH%/}"
if [[ ! -d "$VESTAL_ARCHIVE_PATH" ]]; then
  echo "Vestal: VESTAL_ARCHIVE_PATH ($VESTAL_ARCHIVE_PATH) is not a directory." >&2
  exit 1
fi

if command -v b3sum >/dev/null 2>&1; then
  HASH_CMD=(b3sum --no-names)
elif command -v xxhsum >/dev/null 2>&1; then
  HASH_CMD=(xxhsum -H64)
else
  HASH_CMD=(sha256sum)
fi

START_TIME=$(date +%s)
MANIFEST_TMP=$(mktemp)
trap 'rm -f "$MANIFEST_TMP"' EXIT

# --- failure reporting -----------------------------------------------------
# Same reasoning as the backup-tool agents: anything that goes wrong past
# this point needs to reach Vestal as an explicit failure, not silence.
report_failure() {
  local duration=$(( $(date +%s) - START_TIME ))
  local hashed_so_far
  hashed_so_far=$(wc -l < "$MANIFEST_TMP" 2>/dev/null || echo 0)
  # -G is load-bearing, not cosmetic: without it, curl sends --data-urlencode
  # fields as a POST body, but the ping endpoint only ever reads the URL
  # query string (see src/index.ts's handlePing) — confirmed by testing
  # against a real running instance (2026-07-24, see the other agents'
  # matching comment) that this silently drops the fields without -G.
  curl -fsS -G -m 30 \
    --data-urlencode "message=archive scan failed after hashing ${hashed_so_far} file(s)" \
    --data-urlencode "duration_ms=$((duration * 1000))" \
    "${VESTAL_PING_URL}/fail" >/dev/null || true
}
trap 'report_failure' ERR

curl -fsS -m 15 "${VESTAL_PING_URL}/start" >/dev/null || true

# --- walk and hash -----------------------------------------------------------
# A per-file loop rather than trying to batch every file through one
# hash-tool invocation: b3sum/xxhsum/sha256sum's multi-file output formats
# differ enough that a per-file call is the only thing that stays uniform
# across all three. This only runs on a slow schedule (weekly/monthly),
# not something latency-sensitive, so the per-process overhead is fine.
: > "$MANIFEST_TMP"
while IFS= read -r -d '' file; do
  REL_PATH="${file#"$VESTAL_ARCHIVE_PATH"/}"
  SIZE=$(stat -c '%s' "$file" 2>/dev/null || stat -f '%z' "$file")
  MTIME=$(stat -c '%Y' "$file" 2>/dev/null || stat -f '%m' "$file")
  HASH=$("${HASH_CMD[@]}" "$file" | awk '{print $1}')
  jq -nc --arg path "$REL_PATH" --argjson size "$SIZE" --arg hash "$HASH" --argjson mtime "$MTIME" \
    '{path: $path, size: $size, hash: $hash, mtime: $mtime}' >> "$MANIFEST_TMP"
done < <(find "$VESTAL_ARCHIVE_PATH" -type f -print0)

FILE_COUNT=$(wc -l < "$MANIFEST_TMP")
echo "Vestal: hashed ${FILE_COUNT} file(s) under ${VESTAL_ARCHIVE_PATH}."

# --- upload and report ------------------------------------------------------
DURATION=$(( $(date +%s) - START_TIME ))
MANIFEST_JSON=$(jq -sc '{files: .}' "$MANIFEST_TMP")

RESPONSE=$(curl -fsS -m 120 \
  -H "content-type: application/json" \
  -d "$MANIFEST_JSON" \
  "${VESTAL_PING_URL}/archive-sync")

echo "Vestal: archive sync complete (${DURATION}s). ${RESPONSE}"
