import { useState } from "preact/hooks";
import { useToast } from "../context/toast";

/**
 * Shows a secret exactly once with a copy button and an explicit
 * acknowledgement step — mirrors how the backend itself treats API keys
 * (returned once, never retrievable again), so the UI shouldn't let
 * someone navigate away from this without a clear "did you save it" beat.
 */
export function ApiKeyReveal({ apiKey, onAcknowledge }: { apiKey: string; onAcknowledge: () => void }) {
  const [copied, setCopied] = useState(false);
  const { showError } = useToast();

  async function copy() {
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError("Couldn't copy automatically. Select and copy the key manually.");
    }
  }

  return (
    <div class="api-key-reveal">
      <p class="warning-text">
        This is the only time this key will ever be shown. Copy it now and store it somewhere
        safe. Losing it just means regenerating a new one from the dashboard, but any agent
        scripts using the old one will need updating.
      </p>
      <div class="key-box">
        <code>{apiKey}</code>
        <button type="button" class="btn-secondary" onClick={copy}>
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <button type="button" class="btn-primary" onClick={onAcknowledge}>
        I've saved it, continue
      </button>
    </div>
  );
}
