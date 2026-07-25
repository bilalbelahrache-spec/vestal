import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { useToast } from "../context/toast";
import type { CheckWithPingUrl, ConfigAuditFinding, DrillRun, FlaggedArchiveFile } from "../types";
import { relativeTime, humanDuration, humanMs, STATUS_LABELS } from "../format";
import { ConfirmDialog } from "./ConfirmDialog";
import { DurationInput } from "./DurationInput";
import { useTilt } from "../lib/motion";

function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Lazily-loaded detail panel behind the config-audit badge — fetches
 * findings only once, the first time it's expanded, not on every card render. */
function ConfigAuditDetail({ checkId }: { checkId: string }) {
  const { showError } = useToast();
  const [findings, setFindings] = useState<ConfigAuditFinding[] | null>(null);

  useEffect(() => {
    api
      .configAuditFindings(checkId)
      .then(setFindings)
      .catch((err) => {
        showError(err instanceof ApiError ? err.message : "Couldn't load config audit findings.");
        setFindings([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkId]);

  if (findings === null) {
    return <p class="detail-panel-loading">Loading findings…</p>;
  }

  return (
    <ul class="finding-list">
      {findings.map((f) => (
        <li class={`finding-item is-${f.severity}`}>{f.message}</li>
      ))}
    </ul>
  );
}

/** Same lazy pattern for the archive integrity badge's flagged-file list. */
function ArchiveFilesDetail({ checkId }: { checkId: string }) {
  const { showError } = useToast();
  const [files, setFiles] = useState<FlaggedArchiveFile[] | null>(null);

  useEffect(() => {
    api
      .archiveFlaggedFiles(checkId)
      .then(setFiles)
      .catch((err) => {
        showError(err instanceof ApiError ? err.message : "Couldn't load flagged files.");
        setFiles([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkId]);

  if (files === null) {
    return <p class="detail-panel-loading">Loading flagged files…</p>;
  }

  return (
    <ul class="finding-list">
      {files.map((f) => (
        <li class="finding-item is-warning">
          <code>{f.path}</code> ({humanBytes(f.size)}) — flagged {relativeTime(f.flagged_at)}
        </li>
      ))}
    </ul>
  );
}

/** Same lazy pattern again, for the restore-drill badge — renders the RTO
 * trend as a simple horizontal bar list (no charting library needed: CSP's
 * script-src is self-only, see src/security.ts, and the trend only needs
 * relative duration comparison, not precise plotting). Oldest run first so
 * the bars read left-to-right as a timeline, same direction a line chart
 * would. */
function DrillTrendDetail({ checkId }: { checkId: string }) {
  const { showError } = useToast();
  const [runs, setRuns] = useState<DrillRun[] | null>(null);

  useEffect(() => {
    api
      .drillRuns(checkId)
      .then((r) => setRuns([...r].reverse()))
      .catch((err) => {
        showError(err instanceof ApiError ? err.message : "Couldn't load restore drill history.");
        setRuns([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkId]);

  if (runs === null) {
    return <p class="detail-panel-loading">Loading restore drill history…</p>;
  }

  if (runs.length === 0) {
    return <p class="detail-panel-loading">No restore drills have run yet for this check.</p>;
  }

  const maxDuration = Math.max(...runs.map((r) => r.duration_ms), 1);

  return (
    <div class="drill-trend">
      {runs.map((r) => (
        <div class={`drill-trend-row${r.status === "fail" ? " is-fail" : ""}`}>
          <span class="drill-trend-date">{relativeTime(r.created_at)}</span>
          <span class="drill-trend-bar-track">
            <span class="drill-trend-bar" style={{ width: `${Math.max(4, (r.duration_ms / maxDuration) * 100)}%` }} />
          </span>
          <span class="drill-trend-duration">
            {r.status === "fail" ? "failed" : humanMs(r.duration_ms)}
            {r.status === "pass" && r.files_restored !== null && r.files_expected !== null
              ? ` · ${r.files_restored}/${r.files_expected} files`
              : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * The embeddable "verified X ago" status badge (see GROWTH_DISTRIBUTION_PLAN.md's
 * trust-badge item and src/badge.ts on the backend). Strictly opt-in — this
 * is just a copyable snippet, never inserted anywhere on the user's behalf.
 * No fetch needed here: the badge URL is derived purely from the check's own
 * id, the same way ping_url already is server-side.
 */
function BadgeDetail({ checkId }: { checkId: string }) {
  const { showError, showSuccess } = useToast();
  const [copied, setCopied] = useState(false);
  const badgeUrl = `${window.location.origin}/api/checks/${checkId}/badge.svg`;
  const markdown = `[![Backup verification status](${badgeUrl})](https://vestalapp.com)`;

  async function copyMarkdown() {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      showSuccess("Copied. Paste it into your README or dashboard.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError("Couldn't copy. Select the text manually.");
    }
  }

  return (
    <div class="badge-detail">
      <p class="detail-panel-loading">
        A live status image for this check, safe to share publicly, it only shows pass/fail and
        when it last checked in. Drop it into a GitHub README or a homelab dashboard.
      </p>
      <img src={badgeUrl} alt="Backup verification status" width="121" height="20" />
      <div class="key-box">
        <code>{markdown}</code>
        <button type="button" class="btn-secondary" onClick={copyMarkdown}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
    </div>
  );
}

/** Lets a user set/change/clear the reminder cadence used by
 * findOverdueDrillChecks() server-side (see migrations/0015). A reminder,
 * not a trigger — the copy here is explicit that Vestal can't run the
 * drill itself, only nag about it, since agents are pull-based. */
function DrillScheduleEditor({ check, onSaved }: { check: CheckWithPingUrl; onSaved: () => void }) {
  const { showError, showSuccess } = useToast();
  const [enabled, setEnabled] = useState(check.drill_interval_seconds !== null);
  const [seconds, setSeconds] = useState(check.drill_interval_seconds ?? 2592000); // default: monthly
  const [saving, setSaving] = useState(false);

  async function onSave() {
    setSaving(true);
    try {
      const value = enabled ? seconds : null;
      await api.setDrillSchedule(check.id, value);
      onSaved();
      showSuccess(enabled ? `Reminder set for every ${humanDuration(seconds)}.` : "Reminder cleared.");
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't save the drill schedule.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="drill-schedule-editor">
      <p class="detail-panel-loading">
        Vestal can remind you when a restore drill is overdue — it can't run the drill itself, since your
        agent script pings Vestal, not the other way around.
      </p>
      <label class="drill-schedule-toggle">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.currentTarget.checked)} />
        Remind me if no drill has run in
      </label>
      {enabled && <DurationInput seconds={seconds} onChange={setSeconds} defaultUnitSeconds={86400} />}
      <button type="button" class="btn-secondary btn-sm" onClick={onSave} disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

export function CheckList({
  checks,
  onDeleted,
}: {
  checks: CheckWithPingUrl[];
  onDeleted: (id: string) => void;
}) {
  if (checks.length === 0) {
    return <p class="empty-state">No checks yet. Create one below to get started.</p>;
  }
  return (
    <div class="check-list">
      {checks.map((check) => (
        <CheckCard key={check.id} check={check} onDeleted={() => onDeleted(check.id)} />
      ))}
    </div>
  );
}

function CheckCard({ check, onDeleted }: { check: CheckWithPingUrl; onDeleted: () => void }) {
  const { showError, showSuccess } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [openPanel, setOpenPanel] = useState<"config-audit" | "archive-files" | "drills" | "drill-schedule" | "badge" | null>(null);
  const tiltRef = useTilt<HTMLDivElement>(6);

  async function copyPingUrl() {
    try {
      await navigator.clipboard.writeText(check.ping_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError("Couldn't copy. Select the URL manually.");
    }
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      await api.deleteCheck(check.id);
      showSuccess(`Deleted "${check.name}".`);
      onDeleted();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't delete the check.");
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <div class="check-card" ref={tiltRef}>
      <div class="check-card-header">
        <span class={`status-badge status-${check.last_status}`}>{STATUS_LABELS[check.last_status]}</span>
        <h3>{check.name}</h3>
        <span class="backend-tag">{check.backend}</span>
        {check.last_anomaly_at !== null && (
          <span
            class="status-badge status-anomaly"
            title="This check's most recent verification changed far more than usual — could be ransomware, could be a legitimate large change. Worth a look."
          >
            ⚠ Unusual activity
          </span>
        )}
        {check.flagged_archive_file_count > 0 && (
          <button
            type="button"
            class="status-anomaly badge-toggle"
            title="These files changed content with no matching size/modification-time change — possible silent disk corruption (bit rot), not an edit. Click for details."
            onClick={() => setOpenPanel(openPanel === "archive-files" ? null : "archive-files")}
          >
            ⚠ {check.flagged_archive_file_count} file{check.flagged_archive_file_count === 1 ? "" : "s"} possibly corrupted
          </button>
        )}
        {check.config_audit_warning_count > 0 && (
          <button
            type="button"
            class="status-late badge-toggle"
            title="Vestal found something worth reviewing in this check's current backup configuration. Click for details."
            onClick={() => setOpenPanel(openPanel === "config-audit" ? null : "config-audit")}
          >
            ⚠ {check.config_audit_warning_count} config warning{check.config_audit_warning_count === 1 ? "" : "s"}
          </button>
        )}
        {check.last_drill_at !== null && (
          <button
            type="button"
            class={`badge-toggle ${check.last_drill_status === "fail" ? "status-fail" : "status-pass"}`}
            title="A restore drill actually restores a real backup to prove recovery works, not just that a metadata check passed. Click to see the recovery-time trend."
            onClick={() => setOpenPanel(openPanel === "drills" ? null : "drills")}
          >
            {check.last_drill_status === "fail"
              ? "✗ Last restore drill failed"
              : `↻ Restores in ${humanMs(check.last_drill_duration_ms ?? 0)}`}
          </button>
        )}
        <button
          type="button"
          class="status-new badge-toggle"
          title="Set a reminder for when this check's next restore drill is due."
          onClick={() => setOpenPanel(openPanel === "drill-schedule" ? null : "drill-schedule")}
        >
          {check.drill_interval_seconds !== null
            ? `⏰ Drilled every ${humanDuration(check.drill_interval_seconds)}`
            : "⏰ Set drill reminder"}
        </button>
        <button
          type="button"
          class="status-new badge-toggle"
          title="Get a live status badge for this check to embed in a README or dashboard."
          onClick={() => setOpenPanel(openPanel === "badge" ? null : "badge")}
        >
          🛡 Get embeddable badge
        </button>
      </div>
      {openPanel === "archive-files" && (
        <div class="detail-panel">
          <ArchiveFilesDetail checkId={check.id} />
        </div>
      )}
      {openPanel === "config-audit" && (
        <div class="detail-panel">
          <ConfigAuditDetail checkId={check.id} />
        </div>
      )}
      {openPanel === "drills" && (
        <div class="detail-panel">
          <DrillTrendDetail checkId={check.id} />
        </div>
      )}
      {openPanel === "drill-schedule" && (
        <div class="detail-panel">
          <DrillScheduleEditor check={check} onSaved={() => setOpenPanel(null)} />
        </div>
      )}
      {openPanel === "badge" && (
        <div class="detail-panel">
          <BadgeDetail checkId={check.id} />
        </div>
      )}
      <dl class="check-meta">
        <dt>Last check-in</dt>
        <dd>{relativeTime(check.last_ping_at)}</dd>
        <dt>Expected every</dt>
        <dd>
          {humanDuration(check.expected_interval_seconds)} (+{humanDuration(check.grace_period_seconds)} grace)
        </dd>
      </dl>
      <div class="key-box">
        <code>{check.ping_url}</code>
        <button type="button" class="btn-secondary" onClick={copyPingUrl}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <button type="button" class="btn-danger-outline" onClick={() => setConfirmOpen(true)}>
        Delete
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Delete this check?"
        message={`"${check.name}" and its ping history will be permanently removed. This can't be undone.`}
        confirmLabel={deleting ? "Deleting…" : "Delete"}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
