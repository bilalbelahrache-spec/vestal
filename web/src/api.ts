import type {
  AlertChannelKind,
  AlertChannelRow,
  BillingConfig,
  CheckWithPingUrl,
  Client,
  ConfigAuditFinding,
  CurrentUser,
  DrillRun,
  FlaggedArchiveFile,
  LedgerEntry,
  LedgerSummary,
  Organization,
  OrganizationInvite,
  OrganizationMember,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Same-origin in production (the SPA and the API are served from the same
// Worker) — an empty base is deliberate, not a placeholder. In local dev
// (`npm run dev` inside web/), Vite's proxy (see vite.config.ts) forwards
// /api and /ping to a separately-running `wrangler dev`, so this stays
// correct in both environments without an env-specific base URL.
const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    credentials: "same-origin",
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!res.ok) {
    let message = `request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // response wasn't JSON — keep the generic message
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  signup: (email: string, password: string, turnstileToken: string) =>
    request<{ id: string; email: string; api_key: string }>("/api/auth/signup", {
      method: "POST",
      body: JSON.stringify({ email, password, turnstile_token: turnstileToken }),
    }),

  login: (email: string, password: string) =>
    request<{ id: string; email: string } | { totp_required: true; pending_token: string }>(
      "/api/auth/login",
      {
        method: "POST",
        body: JSON.stringify({ email, password }),
      },
    ),

  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  me: () => request<CurrentUser>("/api/auth/me"),

  regenerateApiKey: () =>
    request<{ api_key: string }>("/api/api-key/regenerate", { method: "POST" }),

  listChecks: () => request<CheckWithPingUrl[]>("/api/checks"),

  createCheck: (params: {
    name: string;
    backend: string;
    expected_interval_seconds: number;
    grace_period_seconds?: number;
  }) =>
    request<CheckWithPingUrl>("/api/checks", {
      method: "POST",
      body: JSON.stringify(params),
    }),

  deleteCheck: (id: string) => request<{ ok: true }>(`/api/checks/${id}`, { method: "DELETE" }),

  listAlertChannels: () => request<AlertChannelRow[]>("/api/alert-channels"),

  createAlertChannel: (kind: AlertChannelKind, target: string) =>
    request<AlertChannelRow>("/api/alert-channels", {
      method: "POST",
      body: JSON.stringify({ kind, target }),
    }),

  deleteAlertChannel: (id: string) =>
    request<{ ok: true }>(`/api/alert-channels/${id}`, { method: "DELETE" }),

  deleteAccount: (password: string) =>
    request<{ ok: true }>("/api/account", {
      method: "DELETE",
      body: JSON.stringify({ password }),
    }),

  forgotPassword: (email: string) =>
    request<{ ok: true }>("/api/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email }),
    }),

  resetPassword: (token: string, password: string) =>
    request<{ ok: true }>("/api/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token, password }),
    }),

  verifyEmail: (token: string) =>
    request<{ ok: true }>("/api/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token }),
    }),

  resendVerification: () =>
    request<{ ok: true; already_verified?: boolean }>("/api/auth/resend-verification", {
      method: "POST",
    }),

  loginTotp: (pendingToken: string, credential: { code?: string; recoveryCode?: string }) =>
    request<{ id: string; email: string }>("/api/auth/login/totp", {
      method: "POST",
      body: JSON.stringify({
        pending_token: pendingToken,
        code: credential.code,
        recovery_code: credential.recoveryCode,
      }),
    }),

  setupTotp: () =>
    request<{ secret: string; otpauth_url: string }>("/api/totp/setup", { method: "POST" }),

  confirmTotp: (code: string) =>
    request<{ ok: true; recovery_codes: string[] }>("/api/totp/confirm", {
      method: "POST",
      body: JSON.stringify({ code }),
    }),

  disableTotp: (password: string) =>
    request<{ ok: true }>("/api/totp/disable", {
      method: "POST",
      body: JSON.stringify({ password }),
    }),

  billingConfig: () => request<BillingConfig>("/api/billing/config"),

  billingStatus: () =>
    request<{ plan: "free" | "pro"; plan_updated_at: number | null }>("/api/billing/status"),

  cancelSubscription: () => request<{ ok: true }>("/api/billing/cancel", { method: "POST" }),

  configAuditFindings: (checkId: string) =>
    request<ConfigAuditFinding[]>(`/api/checks/${checkId}/config-audit`),

  archiveFlaggedFiles: (checkId: string) =>
    request<FlaggedArchiveFile[]>(`/api/checks/${checkId}/archive-files`),

  ledgerSummary: () => request<LedgerSummary>("/api/ledger/summary"),

  ledgerEntries: () => request<LedgerEntry[]>("/api/ledger/entries"),

  drillRuns: (checkId: string) => request<DrillRun[]>(`/api/checks/${checkId}/drills`),

  listOrganizations: () => request<Organization[]>("/api/organizations"),

  createOrganization: (name: string) =>
    request<Organization>("/api/organizations", { method: "POST", body: JSON.stringify({ name }) }),

  listOrganizationMembers: (orgId: string) =>
    request<OrganizationMember[]>(`/api/organizations/${orgId}/members`),

  addOrganizationMember: (orgId: string, email: string, role?: "owner" | "member") =>
    request<{ ok: true; invited: boolean }>(`/api/organizations/${orgId}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),

  removeOrganizationMember: (orgId: string, userId: string) =>
    request<{ ok: true }>(`/api/organizations/${orgId}/members/${userId}`, { method: "DELETE" }),

  listOrganizationInvites: (orgId: string) =>
    request<OrganizationInvite[]>(`/api/organizations/${orgId}/invites`),

  revokeOrganizationInvite: (orgId: string, inviteId: string) =>
    request<{ ok: true }>(`/api/organizations/${orgId}/invites/${inviteId}`, { method: "DELETE" }),

  listClients: (orgId: string) => request<Client[]>(`/api/organizations/${orgId}/clients`),

  createClient: (orgId: string, name: string) =>
    request<Client>(`/api/organizations/${orgId}/clients`, { method: "POST", body: JSON.stringify({ name }) }),

  deleteClient: (orgId: string, clientId: string) =>
    request<{ ok: true }>(`/api/organizations/${orgId}/clients/${clientId}`, { method: "DELETE" }),

  listOrganizationChecks: (orgId: string) =>
    request<CheckWithPingUrl[]>(`/api/organizations/${orgId}/checks`),

  setDrillSchedule: (checkId: string, drillIntervalSeconds: number | null) =>
    request<{ ok: true }>(`/api/checks/${checkId}/drill-schedule`, {
      method: "PATCH",
      body: JSON.stringify({ drill_interval_seconds: drillIntervalSeconds }),
    }),

  setCheckClient: (checkId: string, clientId: string | null) =>
    request<{ ok: true }>(`/api/checks/${checkId}/client`, {
      method: "PATCH",
      body: JSON.stringify({ client_id: clientId }),
    }),

  createOrgCheck: (params: {
    name: string;
    backend: string;
    expected_interval_seconds: number;
    organization_id: string;
    client_id?: string | null;
  }) =>
    request<CheckWithPingUrl>("/api/checks", { method: "POST", body: JSON.stringify(params) }),
};
