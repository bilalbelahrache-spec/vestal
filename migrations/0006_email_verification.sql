-- Email verification: signup previously created a fully-live account for
-- any email address typed in, whether or not the signer-upper actually
-- controls that inbox. Non-blocking by design (verifying doesn't gate
-- dashboard access — see src/index.ts) since forcing it before login would
-- work against making this easy for a non-technical user; it exists so the
-- account and the UI can honestly show "unverified" and a real link goes
-- out to confirm it, same one-hour-single-use shape as password resets.

ALTER TABLE users ADD COLUMN email_verified_at INTEGER;

CREATE TABLE email_verification_tokens (
  id TEXT PRIMARY KEY,               -- the token itself: 32 random bytes, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER                    -- null until consumed; a used token is never valid again
);

CREATE INDEX idx_email_verification_tokens_user ON email_verification_tokens(user_id);
