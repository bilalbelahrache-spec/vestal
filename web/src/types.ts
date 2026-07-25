// Mirrors src/types.ts on the backend (Worker). Kept as an independent,
// small, hand-synced copy rather than a cross-project import — the two
// are separate build pipelines (Workers runtime vs. browser/Vite) and the
// shape is small enough that duplication is cheaper than fighting Vite's
// filesystem sandboxing to reach outside web/.

export type CheckStatus = "new" | "pass" | "fail" | "late";
export type Plan = "free" | "pro" | "team";
export type AlertChannelKind = "discord" | "webhook" | "slack" | "email";
export type Backend = "restic" | "borg" | "duplicati" | "kopia" | "archive" | "other";

export const BACKENDS: Backend[] = ["restic", "borg", "duplicati", "kopia", "archive", "other"];
export const ALERT_KINDS: AlertChannelKind[] = ["discord", "webhook", "slack", "email"];

export interface CheckRow {
  id: string;
  user_id: string;
  name: string;
  backend: Backend;
  ping_token: string;
  expected_interval_seconds: number;
  grace_period_seconds: number;
  last_ping_at: number | null;
  last_status: CheckStatus;
  last_alerted_at: number | null;
  last_anomaly_at: number | null;
  last_anomaly_score: number | null;
  flagged_archive_file_count: number;
  config_audit_warning_count: number;
  last_drill_at: number | null;
  last_drill_status: "pass" | "fail" | null;
  last_drill_duration_ms: number | null;
  drill_interval_seconds: number | null;
  last_drill_reminder_at: number | null;
  organization_id: string | null;
  client_id: string | null;
  created_at: number;
}

export interface CheckWithPingUrl extends CheckRow {
  ping_url: string;
}

// --- MSP / Team tier — see migrations/0014_organizations.sql. ------------

export type OrganizationRole = "owner" | "member";

export interface Organization {
  id: string;
  name: string;
  owner_user_id: string;
  created_at: number;
  role: OrganizationRole;
}

export interface OrganizationMember {
  user_id: string;
  email: string;
  role: OrganizationRole;
  created_at: number;
}

export interface Client {
  id: string;
  organization_id: string;
  name: string;
  created_at: number;
}

export interface OrganizationInvite {
  id: string;
  organization_id: string;
  email: string;
  role: OrganizationRole;
  invited_by_user_id: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
}

export interface AlertChannelRow {
  id: string;
  user_id: string;
  kind: AlertChannelKind;
  target: string;
  created_at: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  email_verified: boolean;
  totp_enabled: boolean;
  plan: Plan;
  created_at: number;
}

export interface BillingConfig {
  configured: boolean;
  client_token?: string;
  price_id_monthly?: string;
  price_id_annual?: string;
  team_price_id_monthly?: string;
  team_price_id_annual?: string;
  environment?: "sandbox" | "production";
}

export interface ConfigAuditFinding {
  finding_id: string;
  severity: string;
  message: string;
}

export interface FlaggedArchiveFile {
  path: string;
  size: number;
  hash: string;
  mtime: number;
  flagged_at: number;
  flagged_reason: string;
}

export interface LedgerSummary {
  configured: boolean;
  entry_count: number;
  latest_entry_at: number | null;
  self_check: { valid: boolean; reason: string | null } | null;
}

export interface LedgerEntry {
  id: string;
  check_id: string;
  check_name: string;
  backend: string;
  status: "pass" | "fail";
  message: string | null;
  prev_hash: string | null;
  entry_hash: string;
  signature: string;
  created_at: number;
}

/** One restore-drill run — see migrations/0013_restore_drills.sql. */
export interface DrillRun {
  id: string;
  check_id: string;
  status: "pass" | "fail";
  duration_ms: number;
  files_restored: number | null;
  files_expected: number | null;
  message: string | null;
  created_at: number;
}
