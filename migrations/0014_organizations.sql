-- MSP / Team tier — see PRO_FEATURES_ROADMAP.md item 6. Not a new
-- monitoring capability, a packaging change: one account manages several
-- clients' checks, grouped and (eventually) billed as a team instead of
-- each client needing their own separate Vestal account.
--
-- Deliberately narrow v1, same "start narrow" pattern already used
-- elsewhere in this file (config auditor: one backend/three rules to
-- start; archive monitor: full-manifest-every-sync instead of client-side
-- diffing): membership is by adding an EXISTING Vestal account's email,
-- not an email-invite flow for people who haven't signed up yet — that's
-- a real, separate feature (needs its own email template, pending-invite
-- state, expiry) flagged as a next step, not silently skipped.
CREATE TABLE organizations (
  id TEXT PRIMARY KEY,               -- uuid
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

-- Every member, including the owner, gets a row here — one table to check
-- "is this user allowed to see this org's data," not two different code
-- paths for "the owner" vs "everyone else."
CREATE TABLE organization_members (
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,                -- 'owner' | 'member'
  created_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
CREATE INDEX idx_organization_members_user ON organization_members(user_id);

-- A "client" is just a grouping label within an org (an MSP's customer),
-- not a login of its own — clients don't authenticate, they're a tag on
-- a set of checks, same relationship a folder has to files.
CREATE TABLE clients (
  id TEXT PRIMARY KEY,               -- uuid
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_clients_organization ON clients(organization_id);

-- Both nullable: a check with organization_id = NULL is exactly the
-- personal-account behavior every existing check already has (unchanged).
-- Setting organization_id extends visibility of that check to every
-- member of that org, not just checks.user_id (see
-- listChecksVisibleToUser in src/db.ts) — client_id is only meaningful
-- once organization_id is set, and is nulled out (not left dangling) if
-- its client is deleted.
ALTER TABLE checks ADD COLUMN organization_id TEXT REFERENCES organizations(id) ON DELETE SET NULL;
ALTER TABLE checks ADD COLUMN client_id TEXT REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX idx_checks_organization ON checks(organization_id);
