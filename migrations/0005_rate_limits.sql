-- Basic abuse protection for unauthenticated endpoints (signup, login,
-- forgot-password, ping ingestion) — previously wide open to brute-force
-- or spam. Fixed-window counters, not sliding-window: simpler, and good
-- enough for "stop obvious abuse," not building a precision rate limiter.

CREATE TABLE rate_limits (
  bucket_key TEXT NOT NULL,    -- e.g. "login:203.0.113.4" or "forgot-password:someone@example.com"
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);
