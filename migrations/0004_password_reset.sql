-- "Forgot my password" recovery, now that real email sending exists
-- (Resend) to actually deliver the reset link. Separate table rather than
-- reusing `sessions` since a reset token has different semantics: it's
-- single-use (`used_at`), much shorter-lived, and proves "you control this
-- email address" rather than "you're already logged in."

CREATE TABLE password_reset_tokens (
  id TEXT PRIMARY KEY,               -- the token itself: 32 random bytes, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER                    -- null until consumed; a used token is never valid again
);

CREATE INDEX idx_password_reset_tokens_user ON password_reset_tokens(user_id);
