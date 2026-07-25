-- MSP / Team tier: invite-by-email for people who don't have a Vestal
-- account yet — see PRO_FEATURES_ROADMAP.md item 6's own scoping note
-- ("adding a team member requires an EXISTING Vestal account... a real,
-- separate feature (its own email template, pending-invite state,
-- expiry)"). This is that feature.
--
-- Deliberately keyed by email, not user_id (the whole point is the
-- invitee doesn't have a user_id yet) — consumed at signup time, same
-- one-shot-token shape as password_reset_tokens/email_verification_tokens,
-- except the "token" here doubles as the accept mechanism AND the lookup
-- key at signup (see consumeOrganizationInvitesForEmail in src/db.ts).
CREATE TABLE organization_invites (
  id TEXT PRIMARY KEY,               -- the token itself: 32 random bytes, base64url
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,                -- 'owner' | 'member'
  invited_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  accepted_at INTEGER                -- null until consumed (by signup or explicit accept)
);

-- Every signup checks "does a pending invite exist for this email" —
-- needs to be fast and needs case-insensitive-friendly lookup (emails are
-- already lowercased before storage elsewhere in this codebase, e.g.
-- login-account rate limiting; invites follow the same convention).
CREATE INDEX idx_organization_invites_email ON organization_invites(email);

-- Powers the "pending invites" list an org owner sees alongside real
-- members.
CREATE INDEX idx_organization_invites_org ON organization_invites(organization_id);
