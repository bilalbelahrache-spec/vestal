-- Billing/subscription plumbing — see PRO_FEATURES_ROADMAP.md's billing
-- note. Vestal sells through Paddle (a Merchant of Record) rather than
-- Stripe directly: Stripe has no Morocco presence at all (no account
-- creation, no payouts to a Moroccan bank), confirmed 2026-07-24, so
-- Paddle is the only workable option for this business, not a preference.
--
-- 'plan' defaults to 'free' for everyone, including every existing row —
-- correct here since no payment system has ever existed before this
-- migration, so no user has ever actually paid for anything.
ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE users ADD COLUMN paddle_customer_id TEXT;
ALTER TABLE users ADD COLUMN paddle_subscription_id TEXT;
ALTER TABLE users ADD COLUMN plan_updated_at INTEGER;

-- Webhooks look up the user by Paddle customer id after the first event
-- (see src/billing.ts) — needs to be a fast lookup, not a table scan.
CREATE INDEX idx_users_paddle_customer_id ON users(paddle_customer_id);
