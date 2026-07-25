import { useState } from "preact/hooks";
import type { JSX } from "preact";
import QRCode from "qrcode";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { api, ApiError } from "../api";
import { ConfirmDialog } from "./ConfirmDialog";

type Stage = "idle" | "setting-up" | "recovery-codes";

export function TwoFactorSetup() {
  const { user, refresh } = useAuth();
  const { showError, showSuccess } = useToast();

  const [stage, setStage] = useState<Stage>("idle");
  const [secret, setSecret] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState("");
  const [disabling, setDisabling] = useState(false);

  if (!user) return null;

  async function startSetup() {
    setStarting(true);
    try {
      const { secret, otpauth_url } = await api.setupTotp();
      setSecret(secret);
      setQrDataUrl(await QRCode.toDataURL(otpauth_url, { margin: 1, width: 220 }));
      setStage("setting-up");
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't start two-factor setup.");
    } finally {
      setStarting(false);
    }
  }

  async function onConfirm(e: JSX.TargetedEvent<HTMLFormElement>) {
    e.preventDefault();
    setConfirming(true);
    try {
      const { recovery_codes } = await api.confirmTotp(code);
      setRecoveryCodes(recovery_codes);
      setStage("recovery-codes");
      await refresh();
    } catch (err) {
      showError(err instanceof ApiError ? err.message : "Couldn't confirm that code.");
    } finally {
      setConfirming(false);
    }
  }

  function cancelSetup() {
    setStage("idle");
    setSecret("");
    setQrDataUrl("");
    setCode("");
  }

  function finishRecoveryCodes() {
    setStage("idle");
    setRecoveryCodes([]);
    showSuccess("Two-factor authentication is on.");
  }

  async function copyRecoveryCodes() {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showError("Couldn't copy automatically. Select and copy the codes manually.");
    }
  }

  async function confirmDisable() {
    if (!disablePassword) return;
    setDisabling(true);
    try {
      await api.disableTotp(disablePassword);
      setDisableOpen(false);
      setDisablePassword("");
      await refresh();
      showSuccess("Two-factor authentication is off.");
    } catch (err) {
      showError(
        err instanceof ApiError && err.status === 401
          ? "Incorrect password."
          : "Couldn't disable two-factor authentication.",
      );
    } finally {
      setDisabling(false);
    }
  }

  if (stage === "recovery-codes") {
    return (
      <div class="totp-setup">
        <p class="warning-text">
          Save these recovery codes somewhere safe. Each one works once, and this is the only
          time they'll be shown — they're what gets you back in if you lose access to your
          authenticator app.
        </p>
        <div class="recovery-codes-box">
          {recoveryCodes.map((rc) => (
            <code>{rc}</code>
          ))}
        </div>
        <div class="totp-setup-actions">
          <button type="button" class="btn-secondary" onClick={copyRecoveryCodes}>
            {copied ? "Copied!" : "Copy all"}
          </button>
          <button type="button" class="btn-primary" onClick={finishRecoveryCodes}>
            I've saved these, continue
          </button>
        </div>
      </div>
    );
  }

  if (stage === "setting-up") {
    return (
      <div class="totp-setup">
        <p>Scan this with your authenticator app (Google Authenticator, Authy, 1Password, etc.):</p>
        {qrDataUrl && <img class="totp-qr" src={qrDataUrl} alt="Two-factor setup QR code" width={220} height={220} />}
        <p class="section-hint">
          Can't scan it? Enter this code manually: <code>{secret}</code>
        </p>
        <form onSubmit={onConfirm}>
          <label>
            Enter the 6-digit code from your app
            <input
              id="totp-confirm-code"
              type="text"
              inputMode="numeric"
              autocomplete="one-time-code"
              placeholder="123456"
              value={code}
              onInput={(e) => setCode(e.currentTarget.value)}
              autoFocus
              required
            />
          </label>
          <div class="totp-setup-actions">
            <button type="button" class="btn-secondary" onClick={cancelSetup}>
              Cancel
            </button>
            <button type="submit" class="btn-primary" disabled={confirming}>
              {confirming ? "Confirming…" : "Confirm and enable"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div class="totp-setup">
      <p class="section-hint">
        {user.totp_enabled
          ? "Two-factor authentication is on. You'll need a code from your authenticator app to log in."
          : "Add a second factor so a leaked password alone isn't enough to log in as you."}
      </p>
      {user.totp_enabled ? (
        <button type="button" class="btn-danger-outline" onClick={() => setDisableOpen(true)}>
          Disable two-factor authentication
        </button>
      ) : (
        <button type="button" class="btn-secondary" onClick={startSetup} disabled={starting}>
          {starting ? "Starting…" : "Enable two-factor authentication"}
        </button>
      )}
      <ConfirmDialog
        open={disableOpen}
        title="Disable two-factor authentication?"
        message="Your account will only need a password to log in again. Enter your password to confirm."
        confirmLabel={disabling ? "Disabling…" : "Disable"}
        danger
        confirmDisabled={!disablePassword || disabling}
        onConfirm={confirmDisable}
        onCancel={() => {
          setDisableOpen(false);
          setDisablePassword("");
        }}
      >
        <label>
          Password
          <input
            type="password"
            autocomplete="current-password"
            value={disablePassword}
            onInput={(e) => setDisablePassword(e.currentTarget.value)}
            autoFocus
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
