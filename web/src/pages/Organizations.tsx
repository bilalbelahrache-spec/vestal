import { useEffect, useState } from "preact/hooks";
import type { JSX } from "preact";
import { api, ApiError } from "../api";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import {
  BACKENDS,
  type Backend,
  type CheckWithPingUrl,
  type Client,
  type Organization,
  type OrganizationInvite,
  type OrganizationMember,
} from "../types";
import { relativeTime, STATUS_LABELS } from "../format";
import { Select } from "../components/Select";
import { DurationInput } from "../components/DurationInput";
import { ConfirmDialog } from "../components/ConfirmDialog";

/**
 * MSP / Team tier — see PRO_FEATURES_ROADMAP.md item 6. One account
 * (an owner) manages several clients' checks, with other team members
 * sharing visibility. Deliberately a single page with in-page org
 * selection rather than a /organizations/:id route — the hand-rolled
 * router (see router.tsx's own comment) is "five routes, zero URL params"
 * on purpose, and adding param support for one page wasn't worth it.
 */
export function Organizations() {
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();
  const [orgs, setOrgs] = useState<Organization[] | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [newOrgName, setNewOrgName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);

  function reloadOrgs() {
    api
      .listOrganizations()
      .then((list) => {
        setOrgs(list);
        setActiveOrgId((current) => current ?? list[0]?.id ?? null);
      })
      .catch((err) => showError(err instanceof ApiError ? err.message : "Couldn't load organizations."));
  }

  useEffect(reloadOrgs, []);

  async function onCreateOrg(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newOrgName.trim()) return;
    setCreatingOrg(true);
    try {
      const org = await api.createOrganization(newOrgName.trim());
      showSuccess(`"${org.name}" created.`);
      setNewOrgName("");
      setOrgs((prev) => [org, ...(prev ?? [])]);
      setActiveOrgId(org.id);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't create the organization.");
    } finally {
      setCreatingOrg(false);
    }
  }

  const activeOrg = orgs?.find((o) => o.id === activeOrgId) ?? null;
  // Team is a strict superset of Pro (same convention as isProUser in
  // src/billing.ts, duplicated here since the frontend doesn't import
  // backend modules) — a Team-plan user must be able to create
  // organizations too, not just Pro exactly.
  const isPro = user?.plan === "pro" || user?.plan === "team";

  return (
    <div class="dashboard organizations-page">
      <section>
        <h2>Organizations</h2>
        <p class="section-hint">
          For MSPs and consultants managing several clients' backups from one account: group checks by
          client, share visibility with teammates, and export a white-labeled status report — not a new
          monitoring capability, just team packaging on top of everything else Vestal already does.
        </p>

        {orgs === null ? (
          <p class="loading-state">Loading…</p>
        ) : orgs.length === 0 ? (
          <p class="empty-state">No organizations yet.</p>
        ) : (
          <div class="org-tabs">
            {orgs.map((o) => (
              <button
                key={o.id}
                type="button"
                class={`org-tab${o.id === activeOrgId ? " is-active" : ""}`}
                onClick={() => setActiveOrgId(o.id)}
              >
                {o.name}
                <span class="plan-badge">{o.role}</span>
              </button>
            ))}
          </div>
        )}

        {isPro ? (
          <form class="inline-form" onSubmit={onCreateOrg}>
            <input
              type="text"
              placeholder="New organization name"
              value={newOrgName}
              onInput={(e) => setNewOrgName(e.currentTarget.value)}
            />
            <button type="submit" class="btn-secondary" disabled={creatingOrg}>
              {creatingOrg ? "Creating…" : "Create organization"}
            </button>
          </form>
        ) : (
          <p class="section-hint">Organizations are a Pro feature — upgrade in the dashboard to create one.</p>
        )}
      </section>

      {activeOrg && <OrganizationDetail org={activeOrg} />}
    </div>
  );
}

function OrganizationDetail({ org }: { org: Organization }) {
  const { showError, showSuccess } = useToast();
  const [members, setMembers] = useState<OrganizationMember[] | null>(null);
  const [invites, setInvites] = useState<OrganizationInvite[] | null>(null);
  const [clients, setClients] = useState<Client[] | null>(null);
  const [checks, setChecks] = useState<CheckWithPingUrl[] | null>(null);
  const [memberEmail, setMemberEmail] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [removeTarget, setRemoveTarget] = useState<OrganizationMember | null>(null);

  function reloadAll() {
    setMembers(null);
    setInvites(null);
    setClients(null);
    setChecks(null);
    api.listOrganizationMembers(org.id).then(setMembers).catch(() => setMembers([]));
    // Only an owner can see pending invites (see the endpoint's own
    // ownership check) — a non-owner member's request 403s, which is
    // expected and just means the section stays empty for them.
    if (org.role === "owner") {
      api.listOrganizationInvites(org.id).then(setInvites).catch(() => setInvites([]));
    } else {
      setInvites([]);
    }
    api.listClients(org.id).then(setClients).catch(() => setClients([]));
    api.listOrganizationChecks(org.id).then(setChecks).catch(() => setChecks([]));
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reloadAll, [org.id]);

  async function onAddMember(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!memberEmail.trim()) return;
    try {
      const result = await api.addOrganizationMember(org.id, memberEmail.trim());
      showSuccess(
        result.invited
          ? `${memberEmail.trim()} doesn't have a Vestal account yet — sent them an invite email. They'll join automatically when they sign up with this address.`
          : `Added ${memberEmail.trim()}.`,
      );
      setMemberEmail("");
      api.listOrganizationMembers(org.id).then(setMembers);
      if (result.invited) api.listOrganizationInvites(org.id).then(setInvites).catch(() => {});
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't add that member.");
    }
  }

  async function onRevokeInvite(invite: OrganizationInvite) {
    try {
      await api.revokeOrganizationInvite(org.id, invite.id);
      showSuccess(`Revoked the invite to ${invite.email}.`);
      setInvites((prev) => (prev ?? []).filter((i) => i.id !== invite.id));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't revoke that invite.");
    }
  }

  async function onRemoveMember(m: OrganizationMember) {
    try {
      await api.removeOrganizationMember(org.id, m.user_id);
      showSuccess(`Removed ${m.email}.`);
      setMembers((prev) => (prev ?? []).filter((x) => x.user_id !== m.user_id));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't remove that member.");
    } finally {
      setRemoveTarget(null);
    }
  }

  async function onCreateClient(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!newClientName.trim()) return;
    try {
      const client = await api.createClient(org.id, newClientName.trim());
      showSuccess(`Client "${client.name}" added.`);
      setNewClientName("");
      setClients((prev) => [...(prev ?? []), client]);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't add that client.");
    }
  }

  async function onDeleteClient(client: Client) {
    try {
      await api.deleteClient(org.id, client.id);
      showSuccess(`Client "${client.name}" removed.`);
      setClients((prev) => (prev ?? []).filter((c) => c.id !== client.id));
      setChecks((prev) => (prev ?? []).map((c) => (c.client_id === client.id ? { ...c, client_id: null } : c)));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't delete that client.");
    }
  }

  async function onMoveCheck(check: CheckWithPingUrl, clientId: string) {
    try {
      await api.setCheckClient(check.id, clientId || null);
      setChecks((prev) => (prev ?? []).map((c) => (c.id === check.id ? { ...c, client_id: clientId || null } : c)));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't move that check.");
    }
  }

  const clientNameById = new Map((clients ?? []).map((c) => [c.id, c.name]));
  const checksByClient = new Map<string, CheckWithPingUrl[]>();
  for (const c of checks ?? []) {
    const key = c.client_id ?? "";
    checksByClient.set(key, [...(checksByClient.get(key) ?? []), c]);
  }

  return (
    <>
      <section class="org-section">
        <div class="org-section-head">
          <h2>Members</h2>
          <a class="btn-secondary" href={`/api/organizations/${org.id}/export.csv`} download>
            Export as CSV
          </a>
          <a class="btn-secondary" href={`/api/organizations/${org.id}/export.pdf`} download>
            Export as PDF
          </a>
        </div>
        {members === null ? (
          <p class="loading-state">Loading…</p>
        ) : (
          <ul class="finding-list">
            {members.map((m) => (
              <li key={m.user_id} class="org-member-row">
                <span>
                  {m.email} <span class="plan-badge">{m.role}</span>
                </span>
                {org.role === "owner" && (
                  <button type="button" class="btn-danger-outline btn-sm" onClick={() => setRemoveTarget(m)}>
                    Remove
                  </button>
                )}
              </li>
            ))}
            {invites && invites.length > 0 && invites.map((inv) => (
              <li key={inv.id} class="org-member-row">
                <span>
                  {inv.email} <span class="plan-badge">{inv.role}</span>{" "}
                  <span class="plan-badge" title="Invited, hasn't signed up yet">
                    invited
                  </span>
                </span>
                <button type="button" class="btn-danger-outline btn-sm" onClick={() => onRevokeInvite(inv)}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
        {org.role === "owner" && (
          <form class="inline-form" onSubmit={onAddMember}>
            <input
              type="email"
              placeholder="teammate@example.com (must already have a Vestal account)"
              value={memberEmail}
              onInput={(e) => setMemberEmail(e.currentTarget.value)}
            />
            <button type="submit" class="btn-secondary">
              Add member
            </button>
          </form>
        )}
      </section>

      <section class="org-section">
        <h2>Clients</h2>
        {clients === null ? (
          <p class="loading-state">Loading…</p>
        ) : clients.length === 0 ? (
          <p class="empty-state">No clients yet — add one to start grouping checks.</p>
        ) : (
          <ul class="finding-list">
            {clients.map((c) => (
              <li key={c.id} class="org-member-row">
                <span>{c.name}</span>
                <button type="button" class="btn-danger-outline btn-sm" onClick={() => onDeleteClient(c)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <form class="inline-form" onSubmit={onCreateClient}>
          <input
            type="text"
            placeholder="Client name"
            value={newClientName}
            onInput={(e) => setNewClientName(e.currentTarget.value)}
          />
          <button type="submit" class="btn-secondary">
            Add client
          </button>
        </form>
      </section>

      <section class="org-section">
        <h2>Checks by client</h2>
        {checks === null ? (
          <p class="loading-state">Loading…</p>
        ) : checks.length === 0 ? (
          <p class="empty-state">
            No checks in this organization yet. Create a check from your dashboard, then move it here.
          </p>
        ) : (
          <>
            {[...(clients ?? []).map((c) => c.id), ""].map((clientId) => {
              const rows = checksByClient.get(clientId) ?? [];
              if (rows.length === 0 && clientId !== "") return null;
              return (
                <div key={clientId || "unassigned"} class="org-client-group">
                  <h3>{clientId ? clientNameById.get(clientId) : "Unassigned"}</h3>
                  {rows.length === 0 ? (
                    <p class="detail-panel-loading">No checks assigned yet.</p>
                  ) : (
                    <ul class="finding-list">
                      {rows.map((chk) => (
                        <li key={chk.id} class="org-member-row">
                          <span>
                            <span class={`status-badge status-${chk.last_status}`}>{STATUS_LABELS[chk.last_status]}</span>{" "}
                            {chk.name} <span class="backend-tag">{chk.backend}</span> — {relativeTime(chk.last_ping_at)}
                          </span>
                          <Select
                            value={chk.client_id ?? ""}
                            options={[{ value: "", label: "Unassigned" }, ...(clients ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                            onChange={(v) => onMoveCheck(chk, v)}
                            ariaLabel={`Move ${chk.name} to client`}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </>
        )}
        <NewOrgCheckForm orgId={org.id} clients={clients ?? []} onCreated={(chk) => setChecks((prev) => [chk, ...(prev ?? [])])} />
      </section>

      <ConfirmDialog
        open={removeTarget !== null}
        title="Remove this member?"
        message={removeTarget ? `${removeTarget.email} will lose access to this organization's checks.` : ""}
        confirmLabel="Remove"
        danger
        onConfirm={() => removeTarget && onRemoveMember(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />
    </>
  );
}

function NewOrgCheckForm({
  orgId,
  clients,
  onCreated,
}: {
  orgId: string;
  clients: Client[];
  onCreated: (check: CheckWithPingUrl) => void;
}) {
  const { showError, showSuccess } = useToast();
  const [name, setName] = useState("");
  const [backend, setBackend] = useState<Backend>("restic");
  const [clientId, setClientId] = useState("");
  const [intervalSeconds, setIntervalSeconds] = useState(86400);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      showError("Give the check a name.");
      return;
    }
    setSubmitting(true);
    try {
      const check = await api.createOrgCheck({
        name: name.trim(),
        backend,
        expected_interval_seconds: intervalSeconds,
        organization_id: orgId,
        client_id: clientId || null,
      });
      onCreated(check);
      showSuccess(`Check "${check.name}" created.`);
      setName("");
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't create the check.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form class="create-check-form" onSubmit={onSubmit}>
      <label>
        Name
        <input type="text" placeholder="e.g. client-a-nightly" value={name} onInput={(e) => setName(e.currentTarget.value)} required />
      </label>
      <label>
        Backend
        <Select value={backend} options={BACKENDS.map((b) => ({ value: b, label: b }))} onChange={(v) => setBackend(v as Backend)} ariaLabel="Backend" />
      </label>
      <label>
        Client
        <Select
          value={clientId}
          options={[{ value: "", label: "Unassigned" }, ...clients.map((c) => ({ value: c.id, label: c.name }))]}
          onChange={setClientId}
          ariaLabel="Client"
        />
      </label>
      <label>
        Expected interval
        <DurationInput seconds={intervalSeconds} onChange={setIntervalSeconds} defaultUnitSeconds={86400} />
      </label>
      <button type="submit" class="btn-primary" disabled={submitting}>
        {submitting ? "Creating…" : "Create check in this organization"}
      </button>
    </form>
  );
}
