import { useRevealGroup } from "../lib/motion";
import { PageHero } from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";
import { Link } from "../router";
import { usePageMeta } from "../lib/seo";

/* Both legal pages, written in plain language on purpose. They describe
   what the system actually does today; if the system changes, these
   change in the same commit. */

export function Privacy() {
  usePageMeta({
    title: "Privacy policy",
    description: "What Vestal collects (almost nothing), what it never does, and how account deletion works.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();
  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Privacy"
        title="Privacy policy"
        lead="Short, because there isn't much to disclose: we collect almost nothing, we sell nothing, and deleting your account really deletes it. Last updated July 23, 2026."
      />
      <section class="container legal-body">
        <h2>What we store</h2>
        <ul>
          <li>Your email address and a salted hash of your password (never the password itself).</li>
          <li>A SHA-256 hash of your API key. We cannot recover the key; nobody can.</li>
          <li>Your checks: names, backup-tool labels, schedules, and their ping tokens.</li>
          <li>
            Ping events: timestamp, pass/fail/start status, and, only if your agent sends
            them, a short message (typically a log tail) and a duration.
          </li>
          <li>Alert destinations you configure: webhook URLs, or the email address alerts go to.</li>
        </ul>
        <p>
          That is the complete list. Vestal's architecture keeps your actual backup data on
          your machines: file contents, repository credentials, and encryption keys have no
          path into our systems at all.
        </p>

        <h2>What we don't do</h2>
        <ul>
          <li>No analytics scripts, ad pixels, or fingerprinting. This site loads nothing from third-party domains.</li>
          <li>No selling, renting, or sharing of your data with anyone, for any reason.</li>
          <li>No marketing emails. Email from Vestal is an alert you asked for, a password reset you requested, or a genuinely important service notice.</li>
          <li>One cookie: your session, HttpOnly, created only when you log in.</li>
        </ul>

        <h2>Who processes data on our behalf</h2>
        <p>
          Vestal runs on <strong>Cloudflare</strong> (hosting, database, data encrypted at
          rest and in transit) and sends email through <strong>Resend</strong> (which sees
          only the recipient address and message content of emails we send you). Both are
          bound by their own published privacy commitments. There is no one else.
        </p>

        <h2>Deletion</h2>
        <p>
          The delete-account button in the dashboard permanently removes your user record,
          checks, ping history, alert channels, sessions, and reset tokens in one atomic
          operation, verified by our own end-to-end tests, which confirm the credentials
          stop working immediately. No soft-delete, no 30-day retention, no "contact
          support to really delete."
        </p>

        <h2>Questions</h2>
        <p>
          <a href="mailto:support@vestalapp.com">support@vestalapp.com</a>, or read the{" "}
          <Link to="/security">security page</Link> for the technical detail behind these
          claims.
        </p>
      </section>
      <SiteFooter />
    </div>
  );
}

export function Refunds() {
  usePageMeta({
    title: "Refund policy",
    description: "Vestal's 14-day money-back guarantee on Pro and Team, explained plainly.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();
  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Refunds"
        title="Refund policy"
        lead="14 days, no questions asked. Last updated July 24, 2026."
      />
      <section class="container legal-body">
        <h2>The policy</h2>
        <p>
          If you're not happy with Vestal Pro for any reason, email{" "}
          <a href="mailto:support@vestalapp.com">support@vestalapp.com</a> within{" "}
          <strong>14 days</strong> of a charge and we'll refund it in full, no questions
          asked. This applies to both the monthly and annual plan.
        </p>
        <p>
          Refunds are processed back to the original payment method, typically within a
          few business days, and handled by Paddle (our{" "}
          <a href="https://www.paddle.com/legal/terms" target="_blank" rel="noreferrer">
            Merchant of Record
          </a>
          ) on our behalf.
        </p>

        <h2>After 14 days</h2>
        <p>
          Past the 14-day window we don't offer partial or pro-rated refunds — cancelling
          stops future billing, and you keep Pro access until the end of the period you
          already paid for. If something's genuinely gone wrong on our end (a billing
          error, a feature that didn't work as described), email us anyway; we'll deal
          with it case by case rather than hide behind the calendar.
        </p>

        <h2>Cancelling</h2>
        <p>
          Cancel anytime from the dashboard's Plan section — no retention flow, no "are you
          sure" maze, and no requirement to contact support first. You keep Pro access
          until your current billing period ends, then your account switches to Free
          automatically.
        </p>

        <h2>Contact</h2>
        <p>
          <a href="mailto:support@vestalapp.com">support@vestalapp.com</a>
        </p>
      </section>
      <SiteFooter />
    </div>
  );
}

export function Terms() {
  usePageMeta({
    title: "Terms of service",
    description: "The terms governing use of Vestal's backup verification service.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();
  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Terms"
        title="Terms of service"
        lead="Plain language, no gotchas. Last updated July 23, 2026."
      />
      <section class="container legal-body">
        <h2>The service</h2>
        <p>
          Vestal monitors check-ins from backup verification agents you run on your own
          systems, and sends alerts when checks fail or go silent. Vestal is a{" "}
          <strong>monitoring layer only</strong>: it does not create, store, or restore
          your backups, and an alert (or the absence of one) is never a guarantee that a
          restore will succeed. You remain responsible for your backup strategy and for
          acting on what Vestal tells you.
        </p>

        <h2>Your account</h2>
        <ul>
          <li>Keep your password, API key, and ping URLs secret: they're bearer credentials.</li>
          <li>Don't use Vestal to abuse others: no flooding third-party webhooks, no probing systems you don't own, no illegal content in ping messages.</li>
          <li>Rate limits exist to keep the service healthy for everyone; deliberately evading them is grounds for account closure.</li>
        </ul>

        <h2>Price and changes</h2>
        <p>
          The free plan stays free, indefinitely, with no card required. The optional Pro
          plan is billed monthly or annually through <strong>Paddle</strong>, our Merchant
          of Record — Paddle handles payment processing and tax compliance, and is the
          merchant of record for your purchase. See our{" "}
          <Link to="/refund">refund policy</Link> for how cancellations and refunds work.
          Nothing is ever charged without your explicit sign-up, and we may change or
          discontinue features from time to time as the product evolves.
        </p>

        <h2>Warranty and liability</h2>
        <p>
          Vestal is provided <strong>"as is," without warranty of any kind</strong>. To the
          maximum extent permitted by law, our liability for any claim related to the
          service is limited to the amount you paid us in the twelve months before the
          claim, which, today, is zero. This is the standard arrangement for a free
          service, stated without the usual fog: do not make Vestal the only thing standing
          between your data and disaster. It's designed to be one honest layer in a
          defense, not the defense.
        </p>

        <h2>License</h2>
        <p>
          The Vestal software is licensed under AGPL-3.0-or-later. Nothing in these terms
          restricts the rights that license grants you over the code itself.
        </p>

        <h2>Contact</h2>
        <p>
          <a href="mailto:support@vestalapp.com">support@vestalapp.com</a>
        </p>
      </section>
      <SiteFooter />
    </div>
  );
}
