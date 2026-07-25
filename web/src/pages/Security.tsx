import { useRevealGroup } from "../lib/motion";
import { CtaBand, PageHero } from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";
import { Link } from "../router";
import { usePageMeta } from "../lib/seo";

const PRACTICES = [
  {
    title: "Your backup data never touches us",
    body: "This is the architecture, not a policy promise. Verification agents run on your machines against your repositories with your credentials. The only bytes that reach Vestal are a pass/fail ping, an optional duration, and an optional short message you control. There is no code path by which file contents, encryption keys, or repository credentials could reach our infrastructure.",
  },
  {
    title: "API keys are unrecoverable by design",
    body: "Keys are 256 bits of random entropy, shown to you exactly once, and stored only as SHA-256 hashes. A database compromise does not hand an attacker your live credential, and we could not email you your key even if you asked, which is the point.",
  },
  {
    title: "Passwords: salted PBKDF2, honestly characterized",
    body: "Passwords are hashed with per-user random salts using PBKDF2-SHA256. The iteration count is bounded by our edge platform's per-request CPU budget and is lower than OWASP's ideal. We say so plainly rather than hiding it: the salt still defeats precomputed-table attacks, and the self-describing hash format lets us raise the cost factor later without invalidating existing accounts. Password verification is constant-time.",
  },
  {
    title: "Sessions and resets that clean up after themselves",
    body: "Session cookies are 256-bit random tokens with a 30-day expiry, HttpOnly. Password-reset tokens live for one hour, are single-use, and a successful reset revokes every existing session for the account: if the old password was compromised, so were its sessions.",
  },
  {
    title: "Rate limiting on every abusable door",
    body: "Signup, login, forgot-password, and the ping endpoints are all rate-limited (for example: 10 login attempts per 15 minutes per IP, 30 pings per minute per token). Brute-forcing credentials or flooding a ping URL hits a wall, not a database.",
  },
  {
    title: "Webhooks are SSRF-screened",
    body: "Alert targets must be https and are checked against loopback, private, link-local, and cloud-metadata address ranges before Vestal will ever call them. Your alert channel can't be turned into a proxy for probing internal networks.",
  },
  {
    title: "The monitor monitors itself",
    body: "The scheduler that watches your checks is wrapped in its own failure detection: if it crashes, it alerts us through an independent path and then surfaces the error to the platform's retry machinery. A public /health endpoint verifies live database connectivity, so you can point your own uptime monitoring at Vestal too.",
  },
  {
    title: "Nothing to track you with",
    body: "No analytics scripts, no ad pixels, no fingerprinting, no third-party JavaScript at all. One session cookie, only after you log in. The site you're reading loads fonts and everything else from our own domain.",
  },
];

export function Security() {
  usePageMeta({
    title: "Security: how Vestal handles your backup data and credentials",
    description:
      "Your backup data never touches Vestal's infrastructure. Unrecoverable API keys, salted PBKDF2 passwords, SSRF-screened webhooks, and rate limiting on every abusable endpoint, explained plainly.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();
  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Security"
        title="Specific claims you can check, not badges"
        lead="Every statement on this page describes the actual running code, not an aspiration. 'Trust us' is never the answer we ask you to accept."
      />

      <section class="container security-list">
        <div class="security-grid reveal-stagger">
          {PRACTICES.map((p, i) => (
            <article class="security-card reveal" style={`--stagger-i: ${i % 6}`}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </article>
          ))}
        </div>

        <div class="security-disclosure reveal">
          <h2>Reporting a vulnerability</h2>
          <p>
            Found something? We want to know, and we'll be grateful rather than defensive.
            Email <a href="mailto:security@vestalapp.com">security@vestalapp.com</a> with
            enough detail to reproduce the issue. You'll get an acknowledgment, a fix
            timeline, and public credit in the <Link to="/changelog">changelog</Link> if
            you'd like it. Please test only against accounts you control. Ask us first if
            you need a sandboxed account to probe harder than normal use allows.
          </p>
        </div>
      </section>

      <CtaBand title="Security you can verify, not just believe." sub="Every claim on this page describes what's actually running in production today." />
      <SiteFooter />
    </div>
  );
}
