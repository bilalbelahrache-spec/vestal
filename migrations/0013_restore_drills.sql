-- Automated restore drills with real RTO reporting — see
-- PRO_FEATURES_ROADMAP.md item 5. A drill is a genuine periodic full
-- restore into a throwaway location, timed, with the restored file count
-- checked against what the backend itself reports as expected — proof the
-- backup actually comes back, not just that its metadata checks out
-- (which is all the regular pass/fail ping proves).
--
-- One row per drill run, append-only (unlike config_audit_findings, which
-- replaces wholesale) — the whole point of this feature is a TREND over
-- time (is recovery getting slower?), so history has to accumulate, not
-- just reflect the latest run.
CREATE TABLE drill_runs (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,              -- 'pass' | 'fail'
  duration_ms INTEGER NOT NULL,
  files_restored INTEGER,            -- null if the backend/step that failed never got far enough to count
  files_expected INTEGER,            -- null if the agent couldn't determine an expected count up front
  message TEXT,
  created_at INTEGER NOT NULL
);

-- Powers the RTO trend chart: most recent N runs for one check, in order.
CREATE INDEX idx_drill_runs_check ON drill_runs(check_id, created_at DESC);

-- Mirrors checks.last_anomaly_at/flagged_archive_file_count (0008/0009) —
-- lets the dashboard show a check's drill status without a second query
-- per check card.
ALTER TABLE checks ADD COLUMN last_drill_at INTEGER;
ALTER TABLE checks ADD COLUMN last_drill_status TEXT;
ALTER TABLE checks ADD COLUMN last_drill_duration_ms INTEGER;
