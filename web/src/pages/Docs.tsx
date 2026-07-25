import type { ComponentChildren, JSX } from "preact";
import { useRevealGroup } from "../lib/motion";
import { CtaBand, PageHero } from "../components/Marketing";
import { SiteFooter } from "../components/SiteFooter";
import { Link } from "../router";
import { usePageMeta } from "../lib/seo";

function jumpTo(id: string) {
  return (e: JSX.TargetedMouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
  };
}

const TOC = [
  { id: "quickstart", label: "Quickstart" },
  { id: "agent-restic", label: "Agent: restic" },
  { id: "agent-borg", label: "Agent: BorgBackup" },
  { id: "agent-kopia", label: "Agent: Kopia" },
  { id: "agent-duplicati", label: "Agent: Duplicati" },
  { id: "ping-api", label: "Ping API" },
  { id: "rest-api", label: "REST API" },
];

function EnvTable({ rows }: { rows: [string, string, ComponentChildren][] }) {
  return (
    <div class="docs-table-wrap">
      <table class="docs-table">
        <thead>
          <tr>
            <th>Variable</th>
            <th>Required</th>
            <th>Meaning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, req, meaning]) => (
            <tr>
              <td>
                <code>{name}</code>
              </td>
              <td>{req}</td>
              <td>{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Docs() {
  usePageMeta({
    title: "Docs: restic, Borg, Kopia, and Duplicati verification agents",
    description:
      "How to set up Vestal's backup verification agents for restic, BorgBackup, Kopia, and Duplicati, plus the ping API and REST API reference.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();
  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Documentation"
        title="Everything you need, on one page"
        lead="From zero to a verified check in about five minutes. The agents are plain bash: read them before you run them, they're short on purpose."
      />

      <div class="docs-layout container">
        <nav class="docs-toc" aria-label="On this page">
          <h4>On this page</h4>
          <ul>
            {TOC.map((t) => (
              <li>
                <a href={`#${t.id}`} onClick={jumpTo(t.id)}>
                  {t.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div class="docs-content">
          {/* ------------------------------------------------ Quickstart */}
          <section id="quickstart" class="docs-section">
            <h2>Quickstart</h2>
            <ol class="docs-steps">
              <li>
                <h3>Create an account and a check</h3>
                <p>
                  <Link to="/signup">Sign up</Link> (email + password, nothing else), then
                  create a check from the dashboard: give it a name, pick your backup
                  tool, and set how often it should report. For a nightly backup,
                  an expected interval of 1 day with a 2 hour grace period is a good
                  default. You'll get a unique <strong>ping URL</strong> for that check.
                </p>
              </li>
              <li>
                <h3>Download the agent for your tool</h3>
                <p>
                  Each agent is a single bash script with no dependencies beyond{" "}
                  <code>curl</code> and your backup tool itself. It does not take
                  backups and never sees your data. It verifies an existing repository
                  and reports the verdict.
                </p>
              </li>
              <li>
                <h3>Add one line after your backup command</h3>
                <pre class="code-block">{`# your existing job, unchanged:
restic backup /srv/data

# new: verify the repository, then report to Vestal:
RESTIC_REPOSITORY=/path/to/repo \\
VESTAL_PING_URL=https://vestalapp.com/ping/<your-token> \\
bash vestal-restic.sh`}</pre>
                <p>
                  That's it. If verification passes, Vestal records a check-in. If it
                  fails, or the script crashes, or the job never runs at all, you get
                  alerted on every channel you've configured.
                </p>
              </li>
            </ol>
          </section>

          {/* ------------------------------------------------ restic */}
          <section id="agent-restic" class="docs-section">
            <h2>Agent: restic</h2>
            <p>
              Runs <code>restic check</code> against your repository. Set{" "}
              <code>VESTAL_READ_DATA_SUBSET</code> to also re-read a percentage of actual
              pack data: slower, but it's the part that catches silent bit-rot that a
              metadata-only check cannot see. Written against restic 0.17+ conventions. If
              you haven't restore-tested a restic repo by hand before, {" "}
              <Link to="/articles/test-restic-backup-restores">this walkthrough</Link> covers
              what actually goes wrong and how to check for it yourself first.
            </p>
            <EnvTable
              rows={[
                ["RESTIC_REPOSITORY", "yes", "your repository, as restic already expects"],
                ["RESTIC_PASSWORD", "yes", <>or <code>RESTIC_PASSWORD_FILE</code> / <code>RESTIC_PASSWORD_COMMAND</code>, as usual</>],
                ["VESTAL_PING_URL", "yes", "the check's ping URL from the dashboard"],
                ["VESTAL_READ_DATA_SUBSET", "no", <>e.g. <code>5%</code>, re-read and verify that share of real data each run</>],
              ]}
            />
            <pre class="code-block">{`RESTIC_REPOSITORY=sftp:backup@nas:/srv/restic-repo \\
RESTIC_PASSWORD_FILE=/root/.restic-pass \\
VESTAL_READ_DATA_SUBSET=5% \\
VESTAL_PING_URL=https://vestalapp.com/ping/<token> \\
bash vestal-restic.sh`}</pre>
          </section>

          {/* ------------------------------------------------ borg */}
          <section id="agent-borg" class="docs-section">
            <h2>Agent: BorgBackup</h2>
            <p>
              Runs <code>borg check</code>. Unlike restic, Borg's{" "}
              <code>--verify-data</code> has no percentage knob: it decrypts and
              CRC-checks every data block or none, so <code>VESTAL_VERIFY_DATA</code> is a
              plain on/off switch. Written against Borg 1.4.x. See how this compares to{" "}
              restic and Kopia's own verify commands{" "}
              <Link to="/articles/compare-check-commands">here</Link>.
            </p>
            <EnvTable
              rows={[
                ["BORG_REPO", "yes", "your repository, as Borg already expects"],
                ["BORG_PASSPHRASE", "yes", <>or <code>BORG_PASSCOMMAND</code> / <code>BORG_PASSPHRASE_FD</code></>],
                ["VESTAL_PING_URL", "yes", "the check's ping URL"],
                ["VESTAL_VERIFY_DATA", "no", <>any non-empty value adds <code>--verify-data</code> (full data verification, all-or-nothing)</>],
              ]}
            />
          </section>

          {/* ------------------------------------------------ kopia */}
          <section id="agent-kopia" class="docs-section">
            <h2>Agent: Kopia</h2>
            <p>
              Runs <code>kopia content verify</code>, and with{" "}
              <code>VESTAL_VERIFY_PERCENT</code> set, a full verify that downloads and
              checksums that share of real data plus{" "}
              <code>kopia snapshot verify</code>. The agent always uses a{" "}
              <strong>fresh cache directory</strong>: in our own pre-release testing, a
              warm local cache reported a deliberately-corrupted repository as healthy.
              That's not a theoretical concern; the agent exists in its current form
              because of it.
            </p>
            <EnvTable
              rows={[
                ["KOPIA_CONFIG_PATH", "yes", "path to the kopia config file for the repository connection"],
                ["VESTAL_PING_URL", "yes", "the check's ping URL"],
                ["VESTAL_VERIFY_PERCENT", "no", <>e.g. <code>10</code>, download and checksum that percentage of file data</>],
              ]}
            />
          </section>

          {/* ------------------------------------------------ duplicati */}
          <section id="agent-duplicati" class="docs-section">
            <h2>Agent: Duplicati</h2>
            <p>
              Runs <code>duplicati-cli test</code> with{" "}
              <code>--full-remote-verification</code> and{" "}
              <strong>retries disabled</strong>. Duplicati's default retry behavior turns
              real corruption into a multi-minute hang instead of a fast failure. With
              retries off, a broken backend produces an immediate{" "}
              <code>Hash mismatch</code> and an immediate alert.
            </p>
            <EnvTable
              rows={[
                ["VESTAL_DUPLICATI_TARGET", "yes", <>the backup's storage URL, e.g. <code>file:///mnt/backups/work</code></>],
                ["VESTAL_DUPLICATI_PASSPHRASE", "yes", "the backup's encryption passphrase"],
                ["VESTAL_PING_URL", "yes", "the check's ping URL"],
                ["VESTAL_DUPLICATI_CLI", "no", <>path to the CLI if it isn't on <code>$PATH</code></>],
                ["VESTAL_VERIFY_SAMPLES", "no", "how many remote file samples to download and verify (default 1)"],
              ]}
            />
          </section>

          {/* ------------------------------------------------ ping api */}
          <section id="ping-api" class="docs-section">
            <h2>Ping API</h2>
            <p>
              Using a tool without a ready-made agent? The ping API is three URLs. The
              token is a 192-bit bearer secret, so treat the URL like a password.
            </p>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>Meaning</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><code>GET|POST /ping/&lt;token&gt;</code></td>
                    <td>success: verification passed</td>
                  </tr>
                  <tr>
                    <td><code>GET|POST /ping/&lt;token&gt;/start</code></td>
                    <td>a run has begun (optional, enables duration tracking)</td>
                  </tr>
                  <tr>
                    <td><code>GET|POST /ping/&lt;token&gt;/fail</code></td>
                    <td>explicit failure: alerts immediately, no waiting for the deadline</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p>
              Optional form/query parameters on any of them:{" "}
              <code>message</code> (short text, e.g. a log tail) and{" "}
              <code>duration_ms</code>. Pings are rate-limited to 30 per minute per token.
            </p>
            <pre class="code-block">{`# minimal integration for any tool, in two lines:
my-backup-tool verify --repo /srv/repo \\
  && curl -fsS https://vestalapp.com/ping/<token> \\
  || curl -fsS https://vestalapp.com/ping/<token>/fail`}</pre>
          </section>

          {/* ------------------------------------------------ rest api */}
          <section id="rest-api" class="docs-section">
            <h2>REST API</h2>
            <p>
              Everything the dashboard does is available with your API key (shown once at
              signup, revocable any time):{" "}
              <code>Authorization: Bearer vs_…</code>. Keys are stored server-side only as
              SHA-256 hashes.
            </p>
            <div class="docs-table-wrap">
              <table class="docs-table">
                <thead>
                  <tr>
                    <th>Endpoint</th>
                    <th>What it does</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td><code>GET /api/checks</code></td><td>list your checks, each with its ping URL</td></tr>
                  <tr><td><code>POST /api/checks</code></td><td>create a check (<code>name</code>, <code>backend</code>, <code>expected_interval_seconds</code>, <code>grace_period_seconds</code>)</td></tr>
                  <tr><td><code>DELETE /api/checks/:id</code></td><td>delete a check and its ping history</td></tr>
                  <tr><td><code>GET /api/alert-channels</code></td><td>list alert channels</td></tr>
                  <tr><td><code>POST /api/alert-channels</code></td><td>add one (<code>kind</code>: discord | slack | email | webhook, <code>target</code>)</td></tr>
                  <tr><td><code>DELETE /api/alert-channels/:id</code></td><td>remove one</td></tr>
                </tbody>
              </table>
            </div>
            <pre class="code-block">{`curl -s https://vestalapp.com/api/checks \\
  -H "Authorization: Bearer vs_your_key" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"nas-nightly","backend":"restic","expected_interval_seconds":86400,"grace_period_seconds":7200}' \\
  -X POST`}</pre>
          </section>
        </div>
      </div>

      <CtaBand title="The docs end here. The setup takes five minutes." />
      <SiteFooter />
    </div>
  );
}
