import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { api, ApiError } from "../api";
import { useToast } from "../context/toast";
import { ALERT_KINDS, type AlertChannelKind, type AlertChannelRow } from "../types";
import { ConfirmDialog } from "./ConfirmDialog";
import { Select } from "./Select";

const TARGET_HINT: Record<AlertChannelKind, string> = {
  discord: "https://discord.com/api/webhooks/...",
  webhook: "https://your-endpoint.example.com/hook",
  slack: "https://hooks.slack.com/services/...",
  email: "you@example.com",
};

export function AlertChannels({
  channels,
  onChanged,
}: {
  channels: AlertChannelRow[];
  onChanged: () => void;
}) {
  const { showError, showSuccess } = useToast();
  const [kind, setKind] = useState<AlertChannelKind>("discord");
  const [target, setTarget] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AlertChannelRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function onSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!target.trim()) {
      showError("Enter a target for this alert channel.");
      return;
    }
    setSubmitting(true);
    try {
      await api.createAlertChannel(kind, target.trim());
      setTarget("");
      showSuccess("Alert channel added.");
      onChanged();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't add that alert channel.");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteAlertChannel(pendingDelete.id);
      showSuccess("Alert channel removed.");
      onChanged();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't remove that alert channel.");
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  }

  return (
    <div class="alert-channels">
      {channels.length === 0 ? (
        <p class="empty-state">
          No alert channels yet. Without one, an overdue or failed check has nowhere to notify you.
        </p>
      ) : (
        <ul class="channel-list">
          {channels.map((c) => (
            <li key={c.id}>
              <span class="channel-kind">{c.kind}</span>
              <span class="channel-target">{c.target}</span>
              <button type="button" class="btn-danger-outline" onClick={() => setPendingDelete(c)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form class="add-channel-form" onSubmit={onSubmit}>
        <Select
          value={kind}
          options={ALERT_KINDS.map((k) => ({ value: k, label: k }))}
          onChange={(v) => setKind(v as AlertChannelKind)}
          ariaLabel="Channel kind"
        />
        <input
          type="text"
          placeholder={TARGET_HINT[kind]}
          value={target}
          onInput={(e) => setTarget(e.currentTarget.value)}
        />
        <button type="submit" class="btn-primary" disabled={submitting}>
          {submitting ? "Adding…" : "Add channel"}
        </button>
      </form>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove this alert channel?"
        message={pendingDelete ? `Checks will no longer notify "${pendingDelete.target}".` : ""}
        confirmLabel={deleting ? "Removing…" : "Remove"}
        danger
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
