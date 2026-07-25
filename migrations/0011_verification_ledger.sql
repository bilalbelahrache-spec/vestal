-- Insurer-grade verification ledger — see PRO_FEATURES_ROADMAP.md item 4
-- and src/ledger.ts. An append-only, hash-chained, Ed25519-signed log of
-- every completed verification (pass or fail), one independent chain PER
-- USER (not global) — chained by user_id so one account's export can be
-- verified on its own without needing every other account's history.
--
-- check_name and backend are denormalized (copied at write time) rather
-- than joined from `checks` — a ledger entry has to remain meaningful and
-- independently verifiable even after the check itself is later deleted;
-- an audit log that goes blank the moment its subject is removed defeats
-- the purpose.
CREATE TABLE ledger_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,
  check_name TEXT NOT NULL,
  backend TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'pass' | 'fail'
  message TEXT,
  prev_hash TEXT,                -- null only for the first entry in a user's chain
  entry_hash TEXT NOT NULL,
  signature TEXT NOT NULL,       -- Ed25519 signature of entry_hash, base64
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_ledger_entries_user ON ledger_entries(user_id, created_at);
