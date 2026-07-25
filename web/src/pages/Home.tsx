import type { JSX } from "preact";
import { Link } from "../router";
import { usePointerGlow, useRevealGroup } from "../lib/motion";
import {
  ChannelMarks,
  CtaBand,
  FaqList,
  MockBadge,
  SectionHead,
  Terminal,
  ToolMarks,
} from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";
import { usePageMeta } from "../lib/seo";

function scrollToId(id: string) {
  return (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };
}

/* --- Content ---------------------------------------------------------- */

const FAILURE_MODES = [
  {
    title: "The cron job quietly died",
    body: "A reboot, a renamed path, an expired credential: the schedule stops firing and nothing anywhere is watching the watcher. The most common backup failure isn't an error. It's silence.",
  },
  {
    title: "The storage rotted underneath it",
    body: "Bit-rot, a half-written pack file, a truncated upload. The repository looks fine from the outside and the backup job keeps reporting success, right up until a restore reads the bad blocks.",
  },
  {
    title: "“Exit code 0” was a lie of omission",
    body: "The job ran. It exited cleanly. But “the command finished” and “the data is restorable” are two different claims, and only one of them is the one you actually care about.",
  },
];

const FEATURES = [
  {
    big: true,
    title: "Verification with proof in hand",
    body: "Vestal's agents run your backup tool's own deep integrity checks: restic check with data re-reads, borg check --verify-data, kopia content verify, duplicati test with full remote verification. They only report success when the repository itself proves sound.",
    visual: "verify",
  },
  {
    big: true,
    title: "A dead-man's switch that understands schedules",
    body: "Every check has an expected interval and a grace period. A missed check-in is treated as seriously as an explicit failure, because a silent cron job and a corrupted repository end the same way: a restore that doesn't.",
    visual: "timer",
  },
  {
    title: "Alerts where your team already lives",
    body: "Discord, Slack, email, and plain webhooks: fan out one failure to all of them. Every channel is exercised against real endpoints, not just unit-tested.",
  },
  {
    title: "One line in your existing job",
    body: "No daemon, no sidecar, no rewrite. Add one script after the backup command you already run. Bash and curl are the only dependencies.",
  },
  {
    title: "Works with anything, not just the four",
    body: "Ready-made agents cover restic, Borg, Kopia, and Duplicati. Everything else, a pg_dump script, an rsync job, a Proxmox backup hook, integrates with two curl calls: one on success, one on failure. If it can run a shell command, it can report to Vestal.",
  },
  {
    title: "start / pass / fail semantics",
    body: "Agents signal when a run begins, report duration and a log tail on success, and fire an explicit fail ping the instant verification breaks, faster and more specific than waiting for a missed deadline.",
  },
  {
    title: "Built to be audited",
    body: "Every agent script is short enough to read in one sitting before you ever run it against a real repository. Trust built on code you can inspect, not a marketing page. Including this one.",
  },
];

const FAQS = [
  {
    q: "Is Vestal actually free?",
    a: (
      <p>
        The core product is, permanently: unlimited checks, alerts, and overdue
        detection, no card required, no trial clock. A paid Pro tier ($9/month or
        $90/year) adds ransomware detection, bit-rot monitoring, config auditing, and a
        signed verification ledger on top — entirely optional. See{" "}
        <Link to="/pricing">pricing</Link> for the honest details.
      </p>
    ),
  },
  {
    q: "Does Vestal ever see my backup data?",
    a: (
      <p>
        No. The verification agent runs on <em>your</em> machine against <em>your</em>{" "}
        repository, using your credentials. The only things sent to Vestal are a ping
        (pass/fail), an optional duration, and an optional short log excerpt you control.
        File contents, encryption keys, and repository credentials never leave your
        infrastructure. Details on the <Link to="/security">security page</Link>.
      </p>
    ),
  },
  {
    q: "How is this different from a cron-monitoring service?",
    a: (
      <p>
        Cron monitors answer "did the job run?" Vestal is built to answer "would the
        restore work?" The agents run your backup tool's own integrity verification
        (re-reading real data, not just listing snapshots) before they ever report
        success. You get the dead-man's-switch behavior too, but the ping means something
        much stronger than "the script reached the end."
      </p>
    ),
  },
  {
    q: "What if Vestal itself goes down?",
    a: (
      <p>
        Two honest answers. First: Vestal runs on Cloudflare's edge with no servers of
        ours to babysit, and the scheduler monitors itself: an internal failure alerts us
        the same way a missed backup alerts you. Second: <code>/health</code> is public,
        so you can point your own uptime monitor at it and verify that for yourself.
      </p>
    ),
  },
  {
    q: "Do I have to be using restic, Borg, Kopia, or Duplicati?",
    a: (
      <p>
        No. Ready-made agents ship for those four because they're what most of this
        audience already runs, but the mechanism underneath is just two{" "}
        <code>curl</code> calls: one on success, one on failure. A pg_dump script, an
        rsync job, anything that can run a shell command, can report to Vestal in
        about five minutes. See the <Link to="/docs">ping API</Link> in the docs.
      </p>
    ),
  },
  {
    q: "What does \"ransomware detection\" actually check?",
    a: (
      <p>
        No black box. Vestal watches each check's own file-churn history and flags a
        run that suddenly rewrites far more of the archive than its normal pattern,
        especially when the changed files pick up a new shared extension: the exact
        signature of a mass-encryption event (<code>photo.jpg</code> becoming{" "}
        <code>photo.jpg.locked</code>). Bit-rot detection is similarly plain: if a
        file's content hash changed but its size and modification time didn't,
        something rewrote the bytes with nothing on the filesystem to explain why.
        Both are statistics verified against real corrupted repositories, not a
        proprietary model, read the agent scripts for the exact thresholds if you want
        them.
      </p>
    ),
  },
  {
    q: "Do I have to change my existing backup jobs?",
    a: (
      <p>
        No. Your backup command stays exactly as it is. You add one script invocation
        after it. The agent verifies the repository your backup just wrote to, then
        reports the result. If you can edit a crontab, you're done in five minutes.
      </p>
    ),
  },
  {
    q: "What data does Vestal store about me?",
    a: (
      <p>
        Your email, a salted hash of your password, a SHA-256 hash of your API key (we
        can't recover the key ourselves), your checks' names and schedules, ping
        timestamps with optional messages, and the alert destinations you configure.
        That's the whole list, and deleting your account genuinely purges all of it. See{" "}
        <Link to="/privacy">privacy</Link>.
      </p>
    ),
  },
];

/* --- Page -------------------------------------------------------------- */

export function Home() {
  usePageMeta({
    title: "Vestal: backup verification & restore testing for restic, Borg, Kopia, Duplicati",
    description:
      "A dead-man's switch for real backup verification. Agents for restic, Borg, Kopia, and Duplicati run genuine integrity checks and alert you the moment a backup stops being restorable.",
  });
  const heroRef = usePointerGlow<HTMLDivElement>();
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div ref={revealRef}>
      {/* ============================ Hero ============================ */}
      <section class="hero" ref={heroRef}>
        <div class="hero-grid container">
          <div class="hero-copy">
            <p class="hero-badge reveal">
              <span class="pulse-dot" aria-hidden="true" />
              Pro is live: ransomware detection, bit-rot monitoring &amp; more
            </p>
            <h1 class="reveal">
              Your backups say they worked.
              <br />
              <span class="gradient-text">Make them prove it.</span>
            </h1>
            <p class="hero-sub reveal">
              Vestal is a dead-man's switch for genuine restore verification. An agent on
              your machine runs your backup tool's own deep integrity checks, then checks
              in. Miss a deadline or fail a check, and the right people hear about it
              immediately, not on restore day.
            </p>
            <div class="hero-actions reveal">
              <Link to="/signup" class="btn-primary btn-lg">
                Start monitoring free
              </Link>
              <a href="#how-it-works" class="btn-secondary btn-lg" onClick={scrollToId("how-it-works")}>
                See how it works
              </a>
            </div>
            <p class="hero-trust reveal">
              Free to start, no card required &middot; Live in under 5 minutes
            </p>
          </div>

          <div class="hero-visual reveal" aria-hidden="true">
            <div class="mock-dash">
              <div class="mock-dash-bar">
                <span class="mock-dash-title">vestalapp.com/dashboard</span>
              </div>
              <div class="mock-dash-body">
                <div class="mock-row">
                  <span class="mock-dot is-ok" />
                  <span class="mock-name">nas-nightly &middot; restic</span>
                  <MockBadge kind="pass">Verified 4h ago</MockBadge>
                </div>
                <div class="mock-row">
                  <span class="mock-dot is-ok" />
                  <span class="mock-name">db-archive &middot; borg</span>
                  <MockBadge kind="pass">Verified 11h ago</MockBadge>
                </div>
                <div class="mock-row is-alert">
                  <span class="mock-dot is-bad" />
                  <span class="mock-name">s3-photos &middot; kopia</span>
                  <MockBadge kind="fail">Failed, alert sent</MockBadge>
                </div>
                <div class="mock-row">
                  <span class="mock-dot is-late" />
                  <span class="mock-name">office-sync &middot; duplicati</span>
                  <MockBadge kind="late">Overdue 2h</MockBadge>
                </div>
              </div>
            </div>
            <div class="mock-alert-card">
              <div class="mock-alert-head">
                <span class="mock-alert-app">Vestal</span>
                <span class="mock-alert-time">now</span>
              </div>
              <p class="mock-alert-body">
                <strong>s3-photos</strong> failed verification: hash mismatch in pack
                file. Repository may be corrupted.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== Integrations strip ==================== */}
      <section class="integrations-strip">
        <div class="container reveal">
          <p class="integrations-label">
            Verifies the tools you already trust. Alerts the places you already look.
          </p>
          <div class="integrations-row">
            <ToolMarks />
            <span class="integrations-divider" aria-hidden="true" />
            <ChannelMarks />
          </div>
        </div>
      </section>

      {/* ========================= The problem ======================== */}
      <section class="problem-band">
        <div class="container">
          <SectionHead
            eyebrow="The uncomfortable part"
            title="Every backup system fails silently, eventually"
            lead="Not because the tools are bad (restic, Borg, Kopia, and Duplicati are excellent), but because nothing in a default setup ever re-proves that the thing you'd restore from is still real."
          />
          <div class="problem-grid reveal-stagger">
            {FAILURE_MODES.map((f, i) => (
              <article class="problem-card reveal" style={`--stagger-i: ${i}`}>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
          <p class="problem-kicker reveal">
            The industry already has a name for the fix: restore testing. Almost nobody
            does it, because doing it by hand is tedious. Vestal makes the verified path
            the lazy path.
          </p>
        </div>
      </section>

      {/* ========================= How it works ======================== */}
      <section class="how-it-works" id="how-it-works">
        <div class="container">
          <SectionHead
            eyebrow="The mechanism"
            title="Three moving parts. None of them are new."
            lead="No daemon to run, no SDK to adopt, no changes to the backup job you already have."
          />
          <ol class="hiw-steps">
            <li class="hiw-step reveal">
              <div class="hiw-step-text">
                <span class="hiw-n tnum">01</span>
                <h3>Your backup runs, untouched</h3>
                <p>
                  Whatever already works (cron, systemd timers, Task Scheduler) keeps
                  doing exactly what it does today. Vestal never touches the backup
                  process itself.
                </p>
              </div>
              <Terminal
                title="crontab (before)"
                lines={[
                  { out: "# 2 a.m. nightly backup, unchanged" },
                  { cmd: "restic backup /srv/data" },
                ]}
              />
            </li>
            <li class="hiw-step reveal">
              <div class="hiw-step-text">
                <span class="hiw-n tnum">02</span>
                <h3>The agent verifies, then reports</h3>
                <p>
                  One added line. The agent runs a real integrity check against the
                  repository, optionally re-reading a percentage of actual data, and
                  pings Vestal only with proof in hand. Failures fire an explicit
                  fail signal with the log tail attached.
                </p>
              </div>
              <Terminal
                title="crontab (after)"
                lines={[
                  { cmd: "restic backup /srv/data" },
                  { cmd: "VESTAL_PING_URL=… bash vestal-restic.sh", tone: "ok" },
                  { out: "✓ repository verified, reported pass (34s)", tone: "ok" },
                ]}
              />
            </li>
            <li class="hiw-step reveal">
              <div class="hiw-step-text">
                <span class="hiw-n tnum">03</span>
                <h3>Silence or failure → alert</h3>
                <p>
                  Vestal's scheduler sweeps every five minutes. A missed deadline past its
                  grace period, or an explicit failure, fans out to every channel you've
                  configured (Discord, Slack, email, webhooks) until it's a fact someone
                  has seen, not a line in a log.
                </p>
              </div>
              <Terminal
                title="#ops (Discord)"
                lines={[
                  { out: "Vestal  ·  today at 02:47" },
                  { out: "nas-nightly missed its check-in", tone: "err" },
                  { out: "expected every 24h + 2h grace, last seen 26h ago", tone: "dim" },
                ]}
              />
            </li>
          </ol>
        </div>
      </section>

      {/* ====================== Features (bento) ======================= */}
      <section class="features">
        <div class="container">
          <SectionHead
            eyebrow="What you get"
            title="Small surface. Sharp edges where it counts."
            lead="Vestal does one job: proving backups restorable and escalating when they aren't. It sweats every detail of that one job."
          />
          <div class="bento reveal-stagger">
            {FEATURES.map((f, i) => (
              <article class={`bento-card${f.big ? " is-big" : ""} reveal`} style={`--stagger-i: ${i}`}>
                {f.visual === "verify" && (
                  <div class="bento-visual">
                    <Terminal
                      title="vestal-kopia.sh"
                      lines={[
                        { cmd: "kopia content verify --full --download-percent=10" },
                        { out: "Verified 4,183 contents, re-read 412 MiB", tone: "dim" },
                        { out: "✓ all verified, reporting pass", tone: "ok" },
                      ]}
                    />
                  </div>
                )}
                {f.visual === "timer" && (
                  <div class="bento-visual bento-timer" aria-hidden="true">
                    <div class="timer-track">
                      <div class="timer-seg is-interval">
                        <span>expected every 24h</span>
                      </div>
                      <div class="timer-seg is-grace">
                        <span>+2h grace</span>
                      </div>
                      <div class="timer-seg is-alert">
                        <span>alert</span>
                      </div>
                    </div>
                  </div>
                )}
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ==================== Deep dive: real corruption ================ */}
      <section class="deep-dive">
        <div class="container deep-dive-grid">
          <div class="deep-dive-copy">
            <SectionHead
              eyebrow="Tested against real corruption"
              title="We corrupted a real repository on purpose. Twice."
            />
            <p class="reveal">
              Before shipping the Kopia agent, we hand-corrupted a pack blob in a real
              repository. First surprise: Kopia's local cache happily reported the
              repository healthy. The corruption was invisible until verification ran
              against a cold cache. The agent now forces a fresh cache on every run,
              because of that test.
            </p>
            <p class="reveal">
              Same exercise for Duplicati found the opposite failure: on real corruption
              its default behavior is to retry into a multi-minute hang instead of failing
              fast. The agent disables retries so a broken repository produces a clear,
              immediate <code>Hash mismatch</code>, and an immediate alert.
            </p>
            <p class="reveal deep-dive-note">
              That's the standard every agent has to meet before it ships: not "the script
              runs," but "it caught deliberately-planted corruption in a live repository."
            </p>
          </div>
          <div class="deep-dive-visual reveal">
            <Terminal
              title="verification catching planted corruption"
              lines={[
                { cmd: "kopia content verify" },
                { out: "using warm local cache…", tone: "dim" },
                { out: "0 errors  ← the lie", tone: "warn" },
                { cmd: "KOPIA_CACHE_DIRECTORY=$(mktemp -d) kopia content verify" },
                { out: "error: invalid checksum for blob p78a41c…", tone: "err" },
                { out: "✗ verification failed. /fail ping sent, alert fired", tone: "err" },
              ]}
            />
          </div>
        </div>
      </section>

      {/* ===================== Security / open strip ==================== */}
      <section class="assurance">
        <div class="container assurance-grid reveal-stagger">
          <article class="assurance-card reveal" style="--stagger-i: 0">
            <h3>Security, in specifics</h3>
            <p>
              API keys stored as SHA-256 hashes. Passwords salted with per-user PBKDF2.
              Webhook targets SSRF-screened. Sign-in, sign-up, and ping endpoints all
              rate-limited. No trackers, one session cookie.
            </p>
            <Link to="/security" class="text-link">
              Read the full security page →
            </Link>
          </article>
          <article class="assurance-card reveal" style="--stagger-i: 1">
            <h3>Source-available, not a black box</h3>
            <p>
              Every agent script is short enough to audit before you ever run it against
              a real repository. Trust built on code you can actually read, not a
              marketing claim you have to take on faith.
            </p>
            <Link to="/about" class="text-link">
              Why we build it this way →
            </Link>
          </article>
          <article class="assurance-card reveal" style="--stagger-i: 2">
            <h3>Built in the open</h3>
            <p>
              Every release note names what broke and what we did about it, including the
              bugs we planted on purpose to prove the agents catch them. No "minor fixes
              and improvements" here.
            </p>
            <Link to="/changelog" class="text-link">
              See the changelog →
            </Link>
          </article>
        </div>
      </section>

      {/* ============================ FAQ =============================== */}
      <section class="faq" id="faq">
        <div class="container faq-grid">
          <div class="faq-head">
            <SectionHead
              eyebrow="Questions"
              title="Asked and answered, plainly"
              lead="If yours isn't here, the docs go deeper, and every claim on this page is checkable against the code."
            />
          </div>
          <FaqList entries={FAQS} />
        </div>
      </section>

      <CtaBand />
      <SiteFooter />
    </div>
  );
}
