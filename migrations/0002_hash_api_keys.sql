-- Store a SHA-256 hash of the API key instead of the raw value, so a
-- database compromise alone doesn't hand over every user's live credential.
-- Existing rows (test data only, pre-launch) are wiped rather than migrated
-- in place, since their old plaintext values would otherwise sit under a
-- column now named api_key_hash without actually being one.

DELETE FROM users;

ALTER TABLE users RENAME COLUMN api_key TO api_key_hash;
