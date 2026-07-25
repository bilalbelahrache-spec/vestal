-- Initial schema for Vestal.
-- Kept deliberately small: this is the minimum needed to prove the
-- ping -> missed-check -> alert loop end to end. No billing/plan
-- columns yet — added when the paid tier is actually wired up.

CREATE TABLE users (
  id TEXT PRIMARY KEY,               -- uuid
  email TEXT NOT NULL UNIQUE,
  api_key TEXT NOT NULL UNIQUE,      -- used to authenticate /api/* requests
  created_at INTEGER NOT NULL        -- unix seconds
);

CREATE TABLE checks (
  id TEXT PRIMARY KEY,               -- uuid
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  backend TEXT NOT NULL,             -- 'restic' | 'borg' | 'duplicati' | 'kopia' | 'other'
  ping_token TEXT NOT NULL UNIQUE,   -- the unguessable part of the ping URL
  expected_interval_seconds INTEGER NOT NULL,  -- how often a ping is expected
  grace_period_seconds INTEGER NOT NULL DEFAULT 3600,
  last_ping_at INTEGER,              -- unix seconds, null until first ping
  last_status TEXT NOT NULL DEFAULT 'new',  -- 'new' | 'pass' | 'fail' | 'late'
  last_alerted_at INTEGER,           -- null if no alert has fired for the current lateness/failure
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_checks_user ON checks(user_id);
CREATE INDEX idx_checks_ping_token ON checks(ping_token);

CREATE TABLE pings (
  id TEXT PRIMARY KEY,               -- uuid
  check_id TEXT NOT NULL REFERENCES checks(id) ON DELETE CASCADE,
  status TEXT NOT NULL,              -- 'pass' | 'fail' | 'start'
  message TEXT,                      -- free-text detail from the agent, e.g. restic output summary
  duration_ms INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_pings_check ON pings(check_id, created_at);

CREATE TABLE alert_channels (
  id TEXT PRIMARY KEY,               -- uuid
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                -- 'discord' | 'webhook' | 'slack' | 'email'
  target TEXT NOT NULL,              -- webhook URL or email address
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_alert_channels_user ON alert_channels(user_id);
