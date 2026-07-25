import { useState } from "preact/hooks";
import { useToast } from "../context/toast";
import { api, ApiError } from "../api";
import { useCheckout } from "../lib/checkout";
import { Link } from "../router";
import { ConfirmDialog } from "./ConfirmDialog";

/**
 * Plan status + upgrade flow. Checkout itself lives in the shared
 * useCheckout() hook (also used by the public Pricing page) — this
 * component is just the dashboard's presentation of it, plus cancellation.
 */
export function BillingPanel() {
  const { showError, showSuccess } = useToast();
  const { user, config, opening, isPro, isTeam, teamOffered, onUpgrade } = useCheckout();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [canceling, setCanceling] = useState(false);

  if (!user) return null;

  async function onConfirmCancel() {
    setCanceling(true);
    try {
      await api.cancelSubscription();
      setConfirmOpen(false);
      showSuccess("Canceled — you'll keep Pro until your current billing period ends, then it switches to Free automatically.");
    } catch (err) {
      showError(
        err instanceof ApiError ? err.message : "Couldn't cancel. Try again, or email support@vestalapp.com.",
      );
    } finally {
      setCanceling(false);
    }
  }

  return (
    <section>
      <h2>Plan</h2>
      <p class="section-hint">
        {isTeam
          ? "You're on Team: everything in Pro, plus unlimited clients per organization — no per-endpoint fees, ever."
          : isPro
            ? "You're on Pro: the ransomware canary, archive integrity monitor, config auditor, and verification ledger are all active on your checks."
            : "You're on the free plan (unlimited checks, alerts, and overdue detection). Pro adds the ransomware canary, archive integrity monitor, config auditor, and insurer-grade verification ledger."}
      </p>
      {isTeam ? (
        <div class="billing-upgrade-buttons">
          <span class="plan-badge plan-badge-pro">Team</span>
          <button type="button" class="btn-secondary btn-sm" onClick={() => setConfirmOpen(true)}>
            Cancel subscription
          </button>
        </div>
      ) : isPro ? (
        <div class="billing-upgrade-buttons">
          <span class="plan-badge plan-badge-pro">Pro</span>
          <button type="button" class="btn-secondary btn-sm" onClick={() => setConfirmOpen(true)}>
            Cancel subscription
          </button>
        </div>
      ) : config?.configured ? (
        <div class="billing-upgrade-buttons">
          <button type="button" class="btn-secondary" onClick={() => onUpgrade("monthly")} disabled={opening !== null}>
            {opening === "monthly" ? "Opening checkout…" : "Upgrade — $9/month"}
          </button>
          <button type="button" class="btn-primary" onClick={() => onUpgrade("annual")} disabled={opening !== null}>
            {opening === "annual" ? "Opening checkout…" : "Upgrade — $90/year (2 months free)"}
          </button>
        </div>
      ) : (
        <span class="plan-badge">Free</span>
      )}
      {!isTeam && teamOffered && !isPro && (
        <p class="section-hint billing-team-upsell">
          Running an organization with more than {" "}
          <Link to="/organizations">a handful of clients</Link>? Team gives you unlimited clients per
          organization for a flat rate.{" "}
          <button
            type="button"
            class="btn-link"
            onClick={() => onUpgrade("monthly", "team")}
            disabled={opening !== null}
          >
            {opening === "team-monthly" ? "Opening checkout…" : "Upgrade to Team — $49/month"}
          </button>{" "}
          or{" "}
          <button
            type="button"
            class="btn-link"
            onClick={() => onUpgrade("annual", "team")}
            disabled={opening !== null}
          >
            {opening === "team-annual" ? "Opening checkout…" : "$490/year (2 months free)"}
          </button>
          .
        </p>
      )}
      {!isTeam && isPro && teamOffered && (
        <p class="section-hint billing-team-upsell">
          Running an organization with more than {" "}
          <Link to="/organizations">a handful of clients</Link>? Email{" "}
          <a href="mailto:support@vestalapp.com">support@vestalapp.com</a> to move from Pro to Team —
          switching plans isn't yet self-serve, so we do it by hand to make sure you're never billed for
          both at once.
        </p>
      )}
      <ConfirmDialog
        open={confirmOpen}
        title="Cancel your Pro subscription?"
        message="You'll keep Pro access until the end of your current billing period, then your account switches to Free automatically. Within 14 days of your last charge you can also get a full refund — see the refund policy for details."
        confirmLabel={canceling ? "Canceling…" : "Cancel subscription"}
        danger
        confirmDisabled={canceling}
        onConfirm={onConfirmCancel}
        onCancel={() => setConfirmOpen(false)}
      />
    </section>
  );
}
