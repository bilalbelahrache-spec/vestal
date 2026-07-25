import { Link } from "../router";
import { useRevealGroup } from "../lib/motion";
import { useCheckout } from "../lib/checkout";
import { usePageMeta } from "../lib/seo";
import { CtaBand, FaqList, PageHero } from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";

const FREE_FEATURES = [
  "Unlimited checks and alert channels",
  "All four verification agents (restic, Borg, Kopia, Duplicati)",
  "Discord, Slack, email, and webhook alerts",
  "5-minute overdue detection sweep",
  "Grace periods and start/pass/fail semantics",
  "Email support",
];

const PRO_FEATURES = [
  "Everything in Free",
  "Ransomware / anomaly canary — flags mass file rewrites, extension changes, and entropy spikes your backup tool's own exit code won't catch",
  "Archive integrity monitor — continuous bit-rot detection for cold/archival data, one flat price no matter how large the archive gets",
  "Backup config & retention auditor — catches real footguns in your backend's actual policy before they cost you the one snapshot you needed",
  "Insurer-grade verification ledger — a signed, tamper-evident record of every successful verification, exportable for a cyber-insurance underwriter or auditor",
  "Organizations with up to 5 clients — group checks by client, share access with teammates",
  "14-day money-back guarantee, cancel anytime from the dashboard",
];

const TEAM_FEATURES = [
  "Everything in Pro",
  "Unlimited clients per organization — no per-endpoint fees, ever, however many clients you add",
  "For MSPs and consultancies past the point a single Pro account's 5-client ceiling makes sense",
  "Same white-label CSV/PDF export, team roles, and email-invite flow, just without the client cap",
  "14-day money-back guarantee, cancel anytime from the dashboard",
];

const PRICING_FAQS = [
  {
    q: "What do I actually get with Pro?",
    a: (
      <p>
        Four things the free plan doesn't have: a ransomware/anomaly canary that watches
        for mass file changes a normal pass/fail ping would miss, an archive integrity
        monitor for bit-rot on cold data, a config &amp; retention auditor that flags
        real misconfigurations, and a cryptographically signed verification ledger you
        can hand to an insurer or auditor. All four run alongside the free plan's
        unlimited checks and alerts, not instead of them.
      </p>
    ),
  },
  {
    q: "Which backends do the Pro features cover today?",
    a: (
      <p>
        Honestly, not all four yet, on purpose — we'd rather ship one backend verified
        against a real repository than four guessed from documentation. The ransomware
        canary is live for <strong>restic</strong> today, with Borg, Kopia, and Duplicati
        in active development. The config auditor currently covers <strong>Kopia</strong>{" "}
        policies, since restic and Borg apply retention at prune time with no stored
        policy to read back — that needs a different design, not yet built. The archive
        monitor and verification ledger work identically for every backend already.
      </p>
    ),
  },
  {
    q: "Monthly or annual — what's the difference besides price?",
    a: (
      <p>
        Nothing else. On either Pro or Team, monthly and annual give you the exact same
        features — annual is just cheaper (two months free) if you're sticking around.
        Switch anytime by canceling one and starting the other.
      </p>
    ),
  },
  {
    q: "What's the difference between Pro and Team?",
    a: (
      <p>
        Team is Pro plus one thing: no ceiling on how many clients you can manage inside
        an organization. Pro already includes organizations, up to 5 clients, team member
        roles, and email invites — Team only matters once you're managing more than 5
        clients and need that cap removed. See{" "}
        <Link to="/msp">the MSP/consultant page</Link> for the full breakdown.
      </p>
    ),
  },
  {
    q: "How does billing actually work?",
    a: (
      <p>
        Through <strong>Paddle</strong>, our Merchant of Record — they handle payment
        processing and sales tax/VAT so we never see or store your card details. Cancel
        anytime from the dashboard's Plan section; you keep Pro until the end of the
        period you already paid for, then it switches to Free automatically. See the{" "}
        <Link to="/refund">refund policy</Link> for the 14-day money-back guarantee.
      </p>
    ),
  },
  {
    q: "Is the free plan a trial that will expire?",
    a: (
      <p>
        No. There's no trial clock counting down. The free tier stays genuinely useful
        for a small setup on its own, indefinitely, whether or not you ever upgrade.
      </p>
    ),
  },
];

/**
 * Pro/Team's card CTA: a real "open checkout right here" button pair for a
 * logged-in free user, not a link that sends them to the dashboard just to
 * click the same button a second time. Previously this page only ever
 * linked out — a genuinely inconvenient extra hop for someone who already
 * decided to pay, flagged directly by the person paying for this to be
 * fixed. Managing an ALREADY-active subscription (cancel, see billing
 * history) is left on the dashboard, where the account-management surface
 * actually lives — the fix is for the moment of paying, not for account
 * management in general.
 */
function TierCheckoutCta({
  tier,
  monthlyLabel,
  annualLabel,
}: {
  tier: "pro" | "team";
  monthlyLabel: string;
  annualLabel: string;
}) {
  const { user, config, opening, isPro, isTeam, onUpgrade } = useCheckout();
  const already = tier === "team" ? isTeam : tier === "pro" && isPro;

  if (already) {
    return (
      <Link to="/dashboard" class="btn-secondary btn-lg tier-cta">
        You're on {tier === "team" ? "Team" : "Pro"} — manage it
      </Link>
    );
  }
  // A Pro subscriber looking at the Team card already has an active
  // subscription — a fresh Paddle checkout here would start a second,
  // independent one instead of upgrading the first (see the guard in
  // useCheckout's onUpgrade). Route to a human instead of a button that
  // would just bounce with an error.
  if (tier === "team" && isPro) {
    return (
      <a href="mailto:support@vestalapp.com" class="btn-secondary btn-lg tier-cta">
        Email us to move from Pro to Team
      </a>
    );
  }
  if (!user) {
    return (
      <Link to="/signup" class="btn-primary btn-lg tier-cta">
        Create a free account to upgrade
      </Link>
    );
  }
  if (!config?.configured) {
    return (
      <Link to="/dashboard" class="btn-secondary btn-lg tier-cta">
        Upgrade from your dashboard
      </Link>
    );
  }

  const monthlyKey = tier === "team" ? "team-monthly" : "monthly";
  const annualKey = tier === "team" ? "team-annual" : "annual";
  const primaryClass = tier === "team" ? "btn-secondary" : "btn-primary";

  return (
    <div class="tier-cta tier-cta-buttons">
      <button
        type="button"
        class="btn-secondary btn-lg"
        onClick={() => onUpgrade("monthly", tier)}
        disabled={opening !== null}
      >
        {opening === monthlyKey ? "Opening checkout…" : monthlyLabel}
      </button>
      <button
        type="button"
        class={`${primaryClass} btn-lg`}
        onClick={() => onUpgrade("annual", tier)}
        disabled={opening !== null}
      >
        {opening === annualKey ? "Opening checkout…" : annualLabel}
      </button>
    </div>
  );
}

export function Pricing() {
  usePageMeta({
    title: "Pricing: Vestal backup verification",
    description:
      "Free forever for unlimited checks and alerts. Pro is $9/month for ransomware detection, archive integrity monitoring, config auditing, and a signed verification ledger. Team is $49/month for unlimited clients.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Pricing"
        title="Honest pricing starts with an honest page"
        lead="Free stays free, forever, no card required. Pro is $9/month or $90/year for the four verification features below. Team is $49/month or $490/year, for MSPs and consultancies managing more than 5 clients."
      />

      <section class="pricing-tiers container">
        <div class="tier-grid reveal-stagger">
          <article class="tier-card reveal" style="--stagger-i: 0">
            <h2>Free</h2>
            <div class="tier-price">
              <span class="tier-amount">$0</span>
              <span class="tier-period">forever, no card required</span>
            </div>
            <p class="tier-tagline">
              Everything you need to stop trusting your backups blindly.
            </p>
            <ul class="tier-features">
              {FREE_FEATURES.map((f) => (
                <li>
                  <svg viewBox="0 0 16 16" aria-hidden="true" class="tier-check">
                    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <Link to="/signup" class="btn-secondary btn-lg tier-cta">
              Create an account
            </Link>
          </article>

          <article class="tier-card is-highlight reveal" style="--stagger-i: 1">
            <span class="tier-flag">Most popular</span>
            <h2>Pro</h2>
            <div class="tier-price">
              <span class="tier-amount">$9</span>
              <span class="tier-period">/month, or $90/year (2 months free)</span>
            </div>
            <p class="tier-tagline">
              For anyone whose backups actually matter: ransomware detection, bit-rot
              monitoring, config auditing, and proof for the people who ask for it.
            </p>
            <ul class="tier-features">
              {PRO_FEATURES.map((f) => (
                <li>
                  <svg viewBox="0 0 16 16" aria-hidden="true" class="tier-check">
                    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <TierCheckoutCta tier="pro" monthlyLabel="Upgrade — $9/month" annualLabel="Upgrade — $90/year" />
          </article>

          <article class="tier-card reveal" style="--stagger-i: 2">
            <h2>Team</h2>
            <div class="tier-price">
              <span class="tier-amount">$49</span>
              <span class="tier-period">/month, or $490/year (2 months free)</span>
            </div>
            <p class="tier-tagline">
              For MSPs and consultancies managing more than 5 clients' backups from one
              account.
            </p>
            <ul class="tier-features">
              {TEAM_FEATURES.map((f) => (
                <li>
                  <svg viewBox="0 0 16 16" aria-hidden="true" class="tier-check">
                    <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                  {f}
                </li>
              ))}
            </ul>
            <TierCheckoutCta tier="team" monthlyLabel="Upgrade — $49/month" annualLabel="Upgrade — $490/year" />
          </article>
        </div>
      </section>

      <section class="pricing-faq container">
        <h2 class="reveal">Pricing questions</h2>
        <FaqList entries={PRICING_FAQS} />
      </section>

      <CtaBand title="Five minutes to your first verified check." sub="Free stays free. Upgrade to Pro whenever you actually need it." />
      <SiteFooter />
    </div>
  );
}
