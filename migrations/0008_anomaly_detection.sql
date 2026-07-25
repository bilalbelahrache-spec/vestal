-- Ransomware / anomaly canary. A verification run's diff stats (how much
-- changed since the last one) get scored against that SAME check's own
-- rolling history, not a single global threshold — a repo that legitimately
-- rewrites 40% of its files nightly (VM snapshots, video editing, DB
-- compaction) is different from one that rewrites 1%, and only a per-check
-- baseline can tell the difference. See src/anomaly.ts for the scoring
-- itself.
--
-- Two columns added to `checks` mirror the existing last_ping_at/
-- last_status pattern, so the dashboard can show the latest anomaly state
-- without a join — last_anomaly_at is null until the first flagged run.
ALTER TABLE checks ADD COLUMN last_anomaly_at INTEGER;
ALTER TABLE checks ADD COLUMN last_anomaly_score REAL;

-- anomaly_score is null until there's enough history to score against
-- (see MIN_BASELINE_SAMPLES in src/anomaly.ts) — early runs on a brand new
-- check are recorded so they can BECOME the baseline, but aren't themselves
-- scored against nothing.
CREATE TABLE diff_stats (
  id TEXT PRIMARY KEY,
  check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  files_changed INTEGER NOT NULL,
  files_added INTEGER NOT NULL,
  files_removed INTEGER NOT NULL,
  ext_change_count INTEGER NOT NULL,
  anomaly_score REAL,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_diff_stats_check ON diff_stats(check_id, created_at);
