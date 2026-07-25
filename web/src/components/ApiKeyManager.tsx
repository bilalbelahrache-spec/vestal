import { useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { useToast } from "../context/toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { ApiKeyReveal } from "./ApiKeyReveal";

export function ApiKeyManager() {
  const { showError } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [revealedKey, setRevealedKey] = useState<string | null>(null);

  async function confirmRegenerate() {
    setRegenerating(true);
    try {
      const { api_key } = await api.regenerateApiKey();
      setRevealedKey(api_key);
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't regenerate the key.");
    } finally {
      setRegenerating(false);
      setConfirmOpen(false);
    }
  }

  if (revealedKey) {
    return (
      <div>
        <h3>New API key generated</h3>
        <ApiKeyReveal apiKey={revealedKey} onAcknowledge={() => setRevealedKey(null)} />
      </div>
    );
  }

  return (
    <div>
      <p>
        Your API key authenticates agent scripts (<code>agent/vestal-restic.sh</code>,{" "}
        <code>agent/vestal-borg.sh</code>) and any direct API calls. It's separate from your login:
        losing it doesn't lock you out of your account.
      </p>
      <button type="button" class="btn-secondary" onClick={() => setConfirmOpen(true)}>
        Regenerate API key
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Regenerate your API key?"
        message="The current key will stop working immediately. Any agent scripts or cron jobs using it will need to be updated with the new one."
        confirmLabel={regenerating ? "Regenerating…" : "Regenerate"}
        danger
        onConfirm={confirmRegenerate}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
