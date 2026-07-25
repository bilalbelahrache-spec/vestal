-- Adds password + session auth for the web UI, alongside the existing
-- Bearer API key auth used by agent scripts. Splitting these matters: an
-- API key baked into a cron job is now a revocable, regenerable credential
-- rather than the account's *only* key — losing it no longer means losing
-- the account, which was a real gap flagged in STATUS.md's security audit.
--
-- Wipes existing rows (still pre-launch test data only) rather than leave
-- accounts with no password_hash sitting under a NOT NULL constraint.

DELETE FROM users;

ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,               -- the session cookie's value: 32 random bytes, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);
