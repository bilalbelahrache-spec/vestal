import { useState } from "preact/hooks";
import type { JSX } from "preact";
import { api, ApiError } from "../api";
import { useToast } from "../context/toast";
import { BACKENDS, type Backend, type CheckWithPingUrl } from "../types";
import { DurationInput } from "./DurationInput";
import { Select } from "./Select";

const AGENT_SCRIPT_BY_BACKEND: Partial<Record<Backend, string>> = {
  restic: "vestal-restic.sh",
  borg: "vestal-borg.sh",
  kopia: "vestal-kopia.sh",
  duplicati: "vestal-duplicati.sh",
  archive: "vestal-archive.sh",
};

// The env lines a user must fill in before the agent will run — matches
// each script's own `: "${VAR:?...}"` required-variable checks.
const REPO_ENV_VARS_BY_BACKEND: Partial<Record<Backend, string[]>> = {
  restic: ["RESTIC_REPOSITORY=/path/to/your/repo"],
  borg: ["BORG_REPO=/path/to/your/repo"],
  kopia: ["KOPIA_CONFIG_PATH=/path/to/kopia.config"],
  duplicati: [
    "VESTAL_DUPLICATI_TARGET=file:///path/to/your/backup",
    "VESTAL_DUPLICATI_PASSPHRASE=your-backup-passphrase",
  ],
  archive: ["VESTAL_ARCHIVE_PATH=/path/to/the/folder/you/want/monitored"],
};

// "archive" isn't tied to a backup job the way the others are — it's a
// standalone scan, so it gets its own intro line instead of "after your
// existing X backup command runs."
function agentSnippet(backend: Backend, pingUrl: string): string | null {
  const script = AGENT_SCRIPT_BY_BACKEND[backend];
  const repoLines = REPO_ENV_VARS_BY_BACKEND[backend];
  if (!script || !repoLines) return null;
  const intro =
    backend === "archive"
      ? "# run this on a schedule (weekly/monthly is plenty) via cron:"
      : `# after your existing ${backend} backup command runs, add:`;
  return [intro, ...repoLines, "VESTAL_PING_URL=" + pingUrl, `bash ${script}`].join("\n");
}

export function CreateCheckForm({ onCreated }: { onCreated: (check: CheckWithPingUrl) => void }) {
  const { showError, showSuccess } = useToast();
  const [name, setName] = useState("");
  const [backend, setBackend] = useState<Backend>("restic");
  const [intervalSeconds, setIntervalSeconds] = useState(86400);
  const [graceSeconds, setGraceSeconds] = useState(7200);
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CheckWithPingUrl | null>(null);

  async function onSubmit(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!name.trim()) {
      showError("Give the check a name.");
      return;
    }
    setSubmitting(true);
    try {
      const check = await api.createCheck({
        name: name.trim(),
        backend,
        expected_interval_seconds: intervalSeconds,
        grace_period_seconds: graceSeconds,
      });
      setCreated(check);
      onCreated(check);
      showSuccess(`Check "${check.name}" created.`);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't create the check.");
    } finally {
      setSubmitting(false);
    }
  }

  if (created) {
    const snippet = agentSnippet(created.backend, created.ping_url);
    return (
      <div class="create-check-result">
        <h3>"{created.name}" is set up</h3>
        <p>Ping URL (also visible any time from the check's card):</p>
        <div class="key-box">
          <code>{created.ping_url}</code>
        </div>
        {snippet && (
          <>
            <p>
              {created.backend === "archive"
                ? "Set this up as its own scheduled job:"
                : `Add this to your existing ${created.backend} backup job:`}
            </p>
            <pre class="code-block">{snippet}</pre>
          </>
        )}
        <button type="button" class="btn-secondary" onClick={() => setCreated(null)}>
          Add another check
        </button>
      </div>
    );
  }

  return (
    <form class="create-check-form" onSubmit={onSubmit}>
      <label>
        Name
        <input
          type="text"
          placeholder="e.g. nas-nightly-backup"
          value={name}
          onInput={(e) => setName(e.currentTarget.value)}
          required
        />
      </label>
      <label>
        Backend
        <Select
          value={backend}
          options={BACKENDS.map((b) => ({ value: b, label: b }))}
          onChange={(v) => setBackend(v as Backend)}
          ariaLabel="Backend"
        />
      </label>
      <label>
        Expected interval
        <DurationInput seconds={intervalSeconds} onChange={setIntervalSeconds} defaultUnitSeconds={86400} />
      </label>
      <label>
        Grace period
        <DurationInput seconds={graceSeconds} onChange={setGraceSeconds} defaultUnitSeconds={3600} />
      </label>
      <button type="submit" class="btn-primary" disabled={submitting}>
        {submitting ? "Creating…" : "Create check"}
      </button>
    </form>
  );
}
