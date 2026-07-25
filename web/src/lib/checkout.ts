import { useEffect, useState } from "preact/hooks";
import { useAuth } from "../context/auth";
import { useToast } from "../context/toast";
import { api } from "../api";
import type { BillingConfig } from "../types";

/**
 * Minimal typing for the slice of Paddle.js (window.Paddle) actually used
 * here — not the full SDK surface. Loaded from cdn.paddle.com only when a
 * component that needs checkout actually mounts (see loadPaddleScript
 * below), never bundled or loaded for a visitor who never opens it.
 */
declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: "sandbox" | "production") => void };
      Initialize: (opts: {
        token: string;
        eventCallback?: (event: { name: string }) => void;
      }) => void;
      Checkout: {
        open: (opts: {
          items: Array<{ priceId: string; quantity: number }>;
          customer: { email: string };
          customData: Record<string, string>;
        }) => void;
      };
    };
  }
}

let paddleScriptPromise: Promise<void> | null = null;

/** Loads Paddle.js exactly once per page session, from Paddle's own
 * documented-required URL (cdn.paddle.com — see src/security.ts's CSP
 * comment for the source). */
function loadPaddleScript(): Promise<void> {
  if (window.Paddle) return Promise.resolve();
  if (paddleScriptPromise) return paddleScriptPromise;
  paddleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.paddle.com/paddle/v2/paddle.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load Paddle.js"));
    document.head.appendChild(script);
  });
  return paddleScriptPromise;
}

export type CheckoutCycle = "monthly" | "annual";
export type CheckoutTier = "pro" | "team";
export type CheckoutOpeningState = "monthly" | "annual" | "team-monthly" | "team-annual" | null;

/**
 * The Paddle checkout flow, factored out of BillingPanel so both the
 * dashboard's Plan panel AND the public Pricing page can open the exact
 * same checkout — previously Pricing only linked a logged-in free user to
 * "/dashboard" to upgrade there, an extra hop with no reason to exist once
 * an account already exists. The actual plan flip still happens
 * asynchronously via the /api/billing/webhook Paddle sends after checkout;
 * this hook never sets `plan` itself, it only re-fetches /api/auth/me a
 * few seconds after checkout completes so the badge catches up once the
 * webhook has had a chance to land.
 */
export function useCheckout() {
  const { user, refresh } = useAuth();
  const { showError, showSuccess } = useToast();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [opening, setOpening] = useState<CheckoutOpeningState>(null);

  useEffect(() => {
    api
      .billingConfig()
      .then(setConfig)
      .catch(() => setConfig({ configured: false }));
  }, []);

  const isTeam = user?.plan === "team";
  const isPro = user?.plan === "pro" || isTeam;
  const teamOffered = !!(config?.configured && config.team_price_id_monthly && config.team_price_id_annual);

  async function onUpgrade(cycle: CheckoutCycle, tier: CheckoutTier = "pro") {
    // An already-subscribed user (e.g. Pro clicking the Team upsell) must
    // never reach Paddle.Checkout.open: Paddle treats that as a brand-new,
    // independent subscription rather than a change to the existing one.
    // The webhook would then overwrite paddle_subscription_id with the new
    // sub, silently orphaning the old one — it keeps auto-billing forever
    // with no self-serve way to cancel it, since /api/billing/cancel only
    // ever acts on the current paddle_subscription_id. Direct to support
    // for a manual swap instead of risking a double subscription.
    if (isPro) {
      showError(
        "You already have an active subscription. Email support@vestalapp.com to switch plans — we'll move you over without double-charging you.",
      );
      return;
    }
    const priceId =
      tier === "team"
        ? cycle === "monthly"
          ? config?.team_price_id_monthly
          : config?.team_price_id_annual
        : cycle === "monthly"
          ? config?.price_id_monthly
          : config?.price_id_annual;
    if (!config?.configured || !config.client_token || !priceId || !user) return;
    setOpening(tier === "team" ? (cycle === "monthly" ? "team-monthly" : "team-annual") : cycle);
    try {
      await loadPaddleScript();
      const Paddle = window.Paddle;
      if (!Paddle) throw new Error("Paddle.js did not load");

      Paddle.Environment.set(config.environment === "production" ? "production" : "sandbox");
      Paddle.Initialize({
        token: config.client_token,
        eventCallback: (event) => {
          if (event.name === "checkout.completed") {
            showSuccess(
              `Payment received — activating ${tier === "team" ? "Team" : "Pro"}. This can take a few seconds.`,
            );
            // The webhook that actually flips the plan arrives
            // asynchronously; a single delayed refetch is enough for the
            // badge to catch up without polling indefinitely.
            setTimeout(() => {
              refresh().catch(() => {});
            }, 4000);
          }
        },
      });
      Paddle.Checkout.open({
        items: [{ priceId, quantity: 1 }],
        customer: { email: user.email },
        // Links this checkout's subscription back to the Vestal account —
        // see the webhook handler in src/index.ts for how custom_data.user_id
        // is read back out on the first subscription event.
        customData: { user_id: user.id },
      });
    } catch {
      showError("Couldn't open checkout. Try again in a moment.");
    } finally {
      setOpening(null);
    }
  }

  return { user, config, opening, isPro, isTeam, teamOffered, onUpgrade };
}
