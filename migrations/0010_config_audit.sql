-- Backup config & retention policy auditor — see PRO_FEATURES_ROADMAP.md
-- item 3 and src/audit-rules.ts. Kopia-only for now (see that file's
-- comment for why). Stores the latest findings from the last reported
-- policy snapshot per check, replaced wholesale on each report rather
-- than accumulated — a stale "ignoreFileErrors is on" finding from three
-- policy changes ago is actively misleading, not useful history.
CREATE TABLE config_audit_findings (
  check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  finding_id TEXT NOT NULL,
  severity TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (check_id, finding_id)
);

CREATE INDEX idx_config_audit_findings_check ON config_audit_findings(check_id);

-- Mirrors checks.flagged_archive_file_count (0009) — a denormalized count
-- so the dashboard's existing single listChecksForUser query already has
-- what it needs for a badge, without a second per-check fetch on every
-- page load. Counts "warning" severity only, not "info" — an informational
-- note (like the compression-off tip) shouldn't read as urgent the way a
-- badge implies.
ALTER TABLE checks ADD COLUMN config_audit_warning_count INTEGER NOT NULL DEFAULT 0;
