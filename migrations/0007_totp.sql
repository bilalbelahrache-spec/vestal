-- Optional TOTP-based two-factor authentication (RFC 6238), the standard
-- "scan a QR code into an authenticator app" second factor. Two secret
-- columns rather than one: `totp_secret_pending` holds a freshly generated
-- secret during setup, before the user has proven they actually scanned it
-- correctly by entering a live code; only then does it get promoted to
-- `totp_secret` (the one actually checked at login). This avoids a user
-- locking themselves out by enabling 2FA against a secret their app never
-- actually received (a mis-scanned QR code, a typo'd manual entry).

ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_secret_pending TEXT;

-- One-time backup codes, issued once (and shown once, like the API key)
-- when 2FA is first confirmed enabled — the safety net for "I lost my
-- phone." Regenerating replaces the whole set: old ones stop working the
-- moment new ones are issued, same convention as API key regeneration.
CREATE TABLE totp_recovery_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_totp_recovery_codes_user ON totp_recovery_codes(user_id);

-- The gap between "password verified" and "TOTP code verified" during a
-- 2FA login: password/login issues one of these instead of a real session,
-- the client then submits a code against it, and only success there
-- creates an actual session cookie. Deliberately separate from `sessions`
-- — this proves far less (only that the password step passed) and lives
-- for minutes, not 30 days.
CREATE TABLE pending_2fa_logins (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_pending_2fa_logins_user ON pending_2fa_logins(user_id);
