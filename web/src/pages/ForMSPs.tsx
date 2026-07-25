import { Link } from "../router";
import { useRevealGroup } from "../lib/motion";
import { CtaBand, FaqList, PageHero, SectionHead } from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";
import { usePageMeta } from "../lib/seo";

/**
 * Dedicated landing page for MSPs / IT consultants — the "different pitch
 * than the homelab-facing one" flagged as unbuilt in PRO_FEATURES_ROADMAP.md
 * item 6. The org/client/team feature this page pitches is real and already
 * shipped (see pages/Organizations.tsx); this page just gives it its own
 * front door and its own audience-specific copy instead of leaving it
 * undiscoverable behind a dashboard link. As of 2026-07-25 the Team price
 * and invite-by-email (for teammates who don't have an account yet) are
 * both real and live too — this copy was updated alongside them so the page
 * doesn't keep claiming gaps that have since closed. What's still genuinely
 * missing (an org-aware verification ledger) is called out
 * honestly in the "not yet" section below, not silently dropped.
 */

const PAIN_POINTS = [
  {
    title: "A tab, a login, or a spreadsheet per client",
    body: "Most backup monitoring tools assume one operator watching one environment. The moment you're carrying ten or fifteen clients, you're either juggling that many separate logins or maintaining a hand-built spreadsheet nobody fully trusts on the day it matters.",
  },
  {
    title: "Enterprise RMM pricing for a solo shop",
    body: "Backup verification bundled into an RMM or PSA platform is usually priced and packaged for a team with a dozen technicians, not a one- or two-person consultancy. You end up paying for modules you'll never open just to get the one you need.",
  },
  {
    title: "A client asks for proof, and you improvise",
    body: "\"Can you show me the backups actually work?\" is a normal question from a client or their insurer. Without a standing report, the honest answer is a screenshot and a promise, not something you'd want to hand over in writing.",
  },
];

const BUILT_TODAY = [
  {
    title: "Organizations & client grouping",
    body: "One organization holds every check across every client. Add each client as a named group inside it and checks sort under the right one instead of sitting in a single flat list you have to mentally re-sort every time.",
  },
  {
    title: "Team member roles & email invites",
    body: "Add a colleague by email. If they already have a Vestal account, they get access instantly; if not, they get an invite email and join automatically the moment they sign up with that address. Owners can add and remove members and transfer ownership, so a solo consultancy becomes a two-person team without rebuilding anything.",
  },
  {
    title: "White-label status export",
    body: "Export a CSV (check name, backend, status, last checked-in) or a formatted PDF grouped by client, with no Vestal branding in the visible content. Drop it into whatever report you already send clients, or hand the PDF over as-is.",
  },
  {
    title: "Every verification feature, per client",
    body: "Nothing about organizing checks by client changes what each check does. Real restore-tool integrity verification, dead-man's-switch overdue detection, and (on Pro) ransomware/anomaly and archive integrity monitoring all run exactly the same per check, whichever client it belongs to.",
  },
];

const MSP_FAQS = [
  {
    q: "Is there a separate \"Team\" or \"MSP\" price?",
    a: (
      <p>
        For growing orgs, yes — but not from client #1. Any Pro account ($9/month or
        $90/year) can create an organization and manage up to 5 clients under it at no
        extra cost. Past 5 clients, Team is $49/month or $490/year, flat, for unlimited
        clients in that organization — still nowhere close to the $2–25-per-endpoint
        pricing this page is written against.
      </p>
    ),
  },
  {
    q: "How do I add someone to my organization?",
    a: (
      <p>
        By email. If they already have a Vestal account, they get access to the
        organization immediately. If not, they get an invite email and join
        automatically, with no extra step on their end, the moment they sign up with
        that same address.
      </p>
    ),
  },
  {
    q: "Do my clients get their own login?",
    a: (
      <p>
        No. A "client" inside an organization is a grouping label for checks, not a
        separate account or a portal you'd hand a client credentials to. Only members of
        your organization can see it — clients get the exported report, not a login.
      </p>
    ),
  },
  {
    q: "What's actually in the white-label export?",
    a: (
      <p>
        Your choice of a CSV (each check's name, backend, current status, and when it
        last checked in — plain data, ready to paste into whatever report format you
        already use) or a formatted PDF, grouped by client, with no Vestal branding in
        the visible page content. Neither is built on the cryptographic verification
        ledger yet — that's a per-user hash chain by design, and making it org-aware is
        separate, real engineering.
      </p>
    ),
  },
  {
    q: "Does adding clients cost more per client or per check?",
    a: (
      <p>
        Never per-check, and not per-client until you're past 5. Your first 5 clients in
        an organization are included free on Pro. Past that, Team is one flat monthly or
        annual charge for unlimited clients — not a per-endpoint meter that climbs every
        time you onboard someone new, which is exactly the model this is meant to be
        cheaper than.
      </p>
    ),
  },
];

export function ForMSPs() {
  usePageMeta({
    title: "Vestal for MSPs: backup verification across every client",
    description:
      "One dashboard for backup verification across every client's restic, Borg, Kopia, or Duplicati backups: organizations, team roles, and white-label reports, without RMM-tier pricing.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="For MSPs & IT consultants"
        title="Fifteen clients' backups. Not fifteen browser tabs."
        lead="Vestal's organizations group every client's backup verification under one account, with role-based team access and a white-labeled status export — built for the consultant carrying several clients' backups, not stretched over from a homelab dashboard."
      >
        <div class="hero-actions" style="margin-top: 1.5rem;">
          <Link to="/signup" class="btn-primary btn-lg">
            Start free, upgrade when ready
          </Link>
          <Link to="/organizations" class="btn-secondary btn-lg">
            See the organizations dashboard
          </Link>
        </div>
      </PageHero>

      {/* ========================= The problem ======================== */}
      <section class="problem-band">
        <div class="container">
          <SectionHead
            eyebrow="The part every consultant already knows"
            title="The tooling for this barely exists below “enterprise”"
            lead="A real, validated market pays $2–25 per endpoint, per month, for backup monitoring bundled into tools built for a much bigger team than yours."
          />
          <div class="problem-grid reveal-stagger">
            {PAIN_POINTS.map((p, i) => (
              <article class="problem-card reveal" style={`--stagger-i: ${i}`}>
                <h3>{p.title}</h3>
                <p>{p.body}</p>
              </article>
            ))}
          </div>
          <p class="problem-kicker reveal">
            Vestal's organizations aren't a new monitoring capability — they're the same
            verified backup checks you'd run for one client, grouped so running them for
            fifteen doesn't mean fifteen separate mental models.
          </p>
        </div>
      </section>

      {/* ====================== What's built today ===================== */}
      <section class="security-list">
        <div class="container">
          <SectionHead
            eyebrow="Live today, on Pro — Team past 5 clients"
            title="What's actually built"
            lead="No waitlist, no beta flag. Every item below is running code you can use from your dashboard right now."
          />
          <div class="security-grid reveal-stagger">
            {BUILT_TODAY.map((f, i) => (
              <article class="security-card reveal" style={`--stagger-i: ${i % 6}`}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>

          <div class="security-disclosure reveal">
            <h2>What this isn't, yet</h2>
            <p>
              Honestly, on purpose: the CSV and PDF exports both report current check
              status, not the cryptographically signed verification ledger (that's a
              per-user hash chain by design, and making it org-aware is separate, real
              engineering, not a quick parameterization). A real next step, not silently
              dropped.
            </p>
          </div>
        </div>
      </section>

      {/* ============================ FAQ =============================== */}
      <section class="pricing-faq container">
        <h2 class="reveal">Questions from consultants and small MSPs</h2>
        <FaqList entries={MSP_FAQS} />
      </section>

      <CtaBand
        title="Available today. Free to start, cheap to grow."
        sub="Create a free account, upgrade to Pro ($9/month or $90/year) to create your first organization, and manage up to 5 clients at no extra cost. Only pay Team ($49/month or $490/year) once you actually outgrow that — no sales call, no per-endpoint surprises."
      />
      <SiteFooter />
    </div>
  );
}
