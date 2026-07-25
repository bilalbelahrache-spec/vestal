import { useEffect, useState, useCallback } from "preact/hooks";
import { api, ApiError } from "../api";
import { useToast } from "../context/toast";
import type { AlertChannelRow, CheckWithPingUrl } from "../types";
import { CheckList } from "../components/CheckList";
import { ArchiveHealthPanel } from "../components/ArchiveHealthPanel";
import { CreateCheckForm } from "../components/CreateCheckForm";
import { AlertChannels } from "../components/AlertChannels";
import { BillingPanel } from "../components/BillingPanel";
import { LedgerPanel } from "../components/LedgerPanel";
import { ApiKeyManager } from "../components/ApiKeyManager";
import { CardSkeleton } from "../components/Skeleton";
import { DangerZone } from "../components/DangerZone";
import { VerifyEmailBanner } from "../components/VerifyEmailBanner";
import { TwoFactorSetup } from "../components/TwoFactorSetup";

export function Dashboard() {
  const { showError } = useToast();
  const [checks, setChecks] = useState<CheckWithPingUrl[] | null>(null);
  const [channels, setChannels] = useState<AlertChannelRow[] | null>(null);

  const reloadChecks = useCallback(() => {
    api
      .listChecks()
      .then(setChecks)
      .catch((err) => showError(err instanceof ApiError ? err.message : "Couldn't load checks."));
  }, [showError]);

  const reloadChannels = useCallback(() => {
    api
      .listAlertChannels()
      .then(setChannels)
      .catch((err) =>
        showError(err instanceof ApiError ? err.message : "Couldn't load alert channels."),
      );
  }, [showError]);

  useEffect(() => {
    reloadChecks();
    reloadChannels();
  }, [reloadChecks, reloadChannels]);

  return (
    <div class="dashboard">
      <VerifyEmailBanner />
      <BillingPanel />
      <section>
        <h2>Your checks</h2>
        {checks === null ? (
          <CardSkeleton count={2} />
        ) : (
          <CheckList checks={checks} onDeleted={(id) => setChecks(checks.filter((c) => c.id !== id))} />
        )}
        <CreateCheckForm onCreated={(check) => setChecks((prev) => [check, ...(prev ?? [])])} />
      </section>

      {checks !== null && <ArchiveHealthPanel checks={checks} />}

      <section>
        <h2>Alert channels</h2>
        {channels === null ? <CardSkeleton count={1} /> : (
          <AlertChannels channels={channels} onChanged={reloadChannels} />
        )}
      </section>

      <section>
        <h2>API key</h2>
        <ApiKeyManager />
      </section>

      <section>
        <h2>Two-factor authentication</h2>
        <TwoFactorSetup />
      </section>

      <section>
        <h2>Your data</h2>
        <p class="section-hint">
          Download everything Vestal has on your account: your profile, checks, alert channels,
          and ping history, as a single JSON file.
        </p>
        <a class="btn-secondary" href="/api/account/export" download>
          Export my data
        </a>
      </section>

      <LedgerPanel />

      <section>
        <h2>Danger zone</h2>
        <DangerZone />
      </section>
    </div>
  );
}
