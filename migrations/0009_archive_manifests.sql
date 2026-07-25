-- Archive integrity monitor (bit-rot detection for cold/archival data) —
-- see PRO_FEATURES_ROADMAP.md item 2. Independent of the restic/Borg/
-- Kopia/Duplicati backend entirely: 'archive' is a new Backend value for a
-- check whose agent (agent/vestal-archive.sh) just walks a directory and
-- hashes files, with no backup tool involved at all.
--
-- One row per file per check, upserted in place rather than a full
-- history log — a photo library can be tens of thousands of files, and
-- this only needs to answer "did this file's hash change unexpectedly
-- since we last saw it," not "show me every hash this file has ever had."
-- `flagged_at`/`flagged_reason` mirror the checks table's
-- last_anomaly_at/last_anomaly_score pattern (0008) rather than a
-- separate table, since a flag is inherently per-file, per-check state.
CREATE TABLE archive_files (
  check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,       -- unix seconds, as reported by the agent's filesystem stat
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  flagged_at INTEGER,           -- null unless this file's last update looked like silent corruption
  flagged_reason TEXT,
  PRIMARY KEY (check_id, path)
);

-- Every manifest sync scans "does this check still know about path X" —
-- the primary key above already covers exact lookups, this index is for
-- listing/counting a check's whole archive (dashboard summary, staleness
-- sweep) without a full table scan filtered post-hoc.
CREATE INDEX idx_archive_files_check ON archive_files(check_id);

-- Mirrors checks.last_anomaly_at/last_anomaly_score (0008) — how many
-- files are CURRENTLY flagged for this check, so the dashboard can show a
-- count without a COUNT(*) query on every page load.
ALTER TABLE checks ADD COLUMN flagged_archive_file_count INTEGER NOT NULL DEFAULT 0;
