import { useRevealGroup } from "../lib/motion";
import { CtaBand, PageHero } from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";
import { usePageMeta } from "../lib/seo";

/* Real history, in plain language, including what broke and how we found
   it. Entries are added at the top; nothing here is marketing-invented. */

const ENTRIES: {
  date: string;
  title: string;
  tag: "new" | "improved" | "fixed";
  points: string[];
}[] = [
  {
    date: "July 25, 2026",
    title: "Team tier launched; anomaly canary and restore drills now cover all four backends",
    tag: "new",
    points: [
      "Team is live: $49/month or $490/year via Paddle, same cancel-anytime and 14-day money-back guarantee as Pro. The only difference from Pro is the client ceiling — Pro caps an organization at 5 clients, Team removes that cap entirely, still one flat price no matter how many you add. White-label CSV/PDF export and email invites work identically on both.",
      "The ransomware/anomaly canary (mass file rewrites, extension-change patterns a plain pass/fail ping would miss) now runs on all four backends — restic, Kopia, Borg, and Duplicati — not just restic. Each was verified separately against a real local repository and a real simulated ransomware event (bulk renames adding a .locked extension), and each backend represents that event differently under the hood: Borg's diff output is one JSON object per changed path with a typed change list, Duplicati's compare command reports a delete-then-add pair. All four confirmed the same underlying finding restic surfaced first — a rename shows up as an add plus a remove, never a 'modified' file — which is why the canary scores on extension-change patterns instead of raw modified-file counts.",
      "Restore drills (an actual restore into a throwaway directory, timed, restored file count checked against what the backend itself reports) are now verified for real on Borg and Duplicati too, joining restic and Kopia. The Duplicati drill exposed a genuine bug: Duplicati's own documented exit codes treat 1 (\"successful, nothing changed\") and 2 (\"successful with warnings\") as success, but the agent script's original error handling reported both as hard failures. Fixed by checking Duplicati's real exit-code scheme instead of assuming any nonzero exit means failure, and separately, by switching the expected-file-count source away from a command that was silently counting directories as files.",
    ],
  },
  {
    date: "July 24, 2026",
    title: "Pro launched: ransomware canary, archive integrity, config auditor, verification ledger",
    tag: "new",
    points: [
      "Pro is live: $9/month or $90/year via Paddle, our Merchant of Record, cancel anytime from the dashboard, 14-day money-back guarantee. No more waitlist.",
      "Four features gated behind it, all built and tested against real data before shipping: a ransomware/anomaly canary (restic today, other backends in progress), an archive integrity monitor for bit-rot on cold data, a config & retention auditor (Kopia today), and a cryptographically signed, tamper-evident verification ledger exportable for insurers and auditors.",
      "Found during real checkout testing, not before: Paddle's checkout overlay injects styles at runtime, which our Content-Security-Policy silently blocked, rendering a cropped, unusable checkout box. Fixed by loosening style-src rather than guessing at a URL allowlist. Also found the quantity selector let someone buy multiple seats of a single-seat plan; fixed by locking Paddle's price objects to quantity 1 via their API.",
    ],
  },
  {
    date: "July 23, 2026",
    title: "A real website",
    tag: "improved",
    points: [
      "Complete redesign of the site: new landing page, real documentation, pricing, security, about, and legal pages, plus this changelog.",
      "Self-hosted fonts, no third-party requests anywhere on the site, dark and light themes throughout.",
      "Real project marks for every integration (Discord, Slack, BorgBackup, Kopia, Duplicati, restic) instead of placeholder glyphs.",
      "A clearer pricing page: what's actually free today versus what Pro will add.",
    ],
  },
  {
    date: "July 22, 2026",
    title: "Kopia & Duplicati agents, rate limiting, Slack, self-monitoring",
    tag: "new",
    points: [
      "Verification agents for Kopia and Duplicati, joining restic and Borg. Both were tested by planting real corruption in real repositories, and both tests changed the design: Kopia's warm local cache masked the corruption (the agent now forces a fresh cache every run), and Duplicati's default retries turned a corrupt backend into a long hang (the agent disables them for a fast, clear failure).",
      "Slack alerts implemented for real (Block Kit messages) and fired at a live Slack workspace; Discord likewise confirmed against a live server.",
      "Rate limiting on signup, login, password reset, and pings: brute force and spam now hit a wall.",
      "The scheduler now monitors itself and alerts us if it ever fails, and a public /health endpoint reports live database connectivity.",
    ],
  },
  {
    date: "July 22, 2026",
    title: "vestalapp.com, email alerts, password reset, account deletion",
    tag: "new",
    points: [
      "Vestal moved to its own domain with verified email sending: alert emails and password resets now come from alerts@vestalapp.com.",
      "Full account lifecycle: password reset via one-hour single-use tokens (a successful reset revokes all existing sessions), and account deletion that genuinely purges every row you own.",
      "Fixed for honesty's sake: /health was silently serving the app's HTML instead of the real health check. An uptime monitor pointed at it would have said 'fine' forever. Found by testing it, not by luck.",
    ],
  },
  {
    date: "July 22, 2026",
    title: "Security audit and the web dashboard",
    tag: "improved",
    points: [
      "A full pass over authentication and storage: API keys now stored only as SHA-256 hashes, webhook targets screened against SSRF (loopback, private, link-local, and cloud-metadata addresses rejected), input validation tightened across the API.",
      "The web dashboard shipped: checks, alert channels, API key management, with a real end-to-end browser test suite clicking through every flow against a live instance.",
    ],
  },
  {
    date: "July 2026",
    title: "First release",
    tag: "new",
    points: [
      "Ping ingestion with start/pass/fail semantics, expected intervals and grace periods, and a five-minute sweep for overdue checks.",
      "Discord and generic webhook alerts.",
      "Verification agents for restic and Borg. The restic one immediately earned its keep by exposing an alerting gap during its own live test: an explicit fail ping also refreshes the check-in clock, so it needed to alert immediately rather than waiting out the interval. Fixed before launch.",
    ],
  },
];

export function Changelog() {
  usePageMeta({
    title: "Changelog",
    description:
      "Real history of what shipped, what broke, and how it was found — nothing here is marketing-invented.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();
  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Changelog"
        title="What changed, and what it took"
        lead="Including the bugs. A reliability product that only announces its wins is asking you to trust a highlight reel."
      />

      <section class="container changelog">
        <ol class="changelog-list">
          {ENTRIES.map((e) => (
            <li class="changelog-entry reveal">
              <div class="changelog-meta">
                <time>{e.date}</time>
                <span class={`changelog-tag is-${e.tag}`}>{e.tag}</span>
              </div>
              <div class="changelog-body">
                <h2>{e.title}</h2>
                <ul>
                  {e.points.map((p) => (
                    <li>{p}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <CtaBand />
      <SiteFooter />
    </div>
  );
}
