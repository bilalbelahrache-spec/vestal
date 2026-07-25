import { useRevealGroup } from "../lib/motion";
import { CtaBand, PageHero } from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";
import { Link } from "../router";
import { usePageMeta } from "../lib/seo";

const PRINCIPLES = [
  {
    title: "Verification over monitoring",
    body: "A ping that means \"the script finished\" is monitoring. A ping that means \"we re-read real data from the repository and it checksummed clean\" is verification. Vestal exists for the second kind, and every agent is tested by planting real corruption in a real repository and confirming it gets caught before it ships.",
  },
  {
    title: "Honesty as a feature",
    body: "The pricing page tells you exactly which backends each Pro feature actually covers today, not just what the plan costs. The security page names the one place we're weaker than ideal and why. The changelog describes bugs we actually shipped and how they were found. A backup-trust product that shades the truth about itself has failed at the only thing it sells.",
  },
  {
    title: "Built to be audited, not just believed",
    body: "The agent scripts your infrastructure actually runs are short enough to read end to end before you trust them with real credentials. Verification only works if you're willing to check our work, so we make checking it easy.",
  },
  {
    title: "Small on purpose",
    body: "Vestal runs on Cloudflare's edge with no servers, no VMs, and no ops burden to pass on to customers. It does one job with a deliberately small surface. Fewer moving parts is a reliability strategy, not a limitation.",
  },
];

export function About() {
  usePageMeta({
    title: "About Vestal",
    description:
      "Why Vestal exists: verification over monitoring, honesty as a feature, and a backup-trust tool small enough to audit end to end.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();
  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="About"
        title="Built by people who lost data to a backup that 'worked'"
        lead="Vestal is a small, independent product with one conviction: the only backup claim worth anything is one that's been re-proven recently."
      />

      <section class="container about-body">
        <div class="about-story reveal">
          <h2>Why this exists</h2>
          <p>
            Everyone who has run infrastructure long enough has the same story. The backup
            job was green for months. The cron mail said success. Then a disk died, the
            restore started, and somewhere in the middle: a checksum error, a missing
            pack file, a snapshot that referenced data that wasn't there anymore. The
            backups had been broken for weeks, and every tool in the chain had honestly
            reported that its own step "worked."
          </p>
          <p>
            The fix has been known forever: test your restores. Almost nobody does,
            because it's manual, boring, and always loses to more urgent work. Vestal's
            job is to make verified backups the path of least resistance: one line in
            the job you already run, agents that do the tedious verification properly,
            and an alarm system that treats silence with the suspicion it deserves.
          </p>
        </div>

        <div class="about-principles">
          <h2 class="reveal">What we optimize for</h2>
          <div class="security-grid reveal-stagger">
            {PRINCIPLES.map((p, i) => (
              <article class="security-card reveal" style={`--stagger-i: ${i}`}>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
        </div>

        <div class="about-contact reveal">
          <h2>Talk to us</h2>
          <p>
            Questions, bug reports, a backup tool you want an agent for. Security reports go
            to <a href="mailto:security@vestalapp.com">security@vestalapp.com</a> instead —
            see the <Link to="/security">security page</Link> for how we handle disclosure.
          </p>
          <a href="mailto:support@vestalapp.com" class="btn-secondary">
            Contact us
          </a>
        </div>
      </section>

      <CtaBand />
      <SiteFooter />
    </div>
  );
}
