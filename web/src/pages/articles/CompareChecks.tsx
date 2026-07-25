import { useRevealGroup } from "../../lib/motion";
import { PageHero, CtaBand } from "../../components/Marketing";
import { SiteFooter } from "../../components/SiteFooter";
import { Link } from "../../router";
import { usePageMeta } from "../../lib/seo";

/* Month 2 content-SEO article, see MARKETING_SEO_PLAN.md Part 3. A genuine
   comparison, not a listicle: this audience punishes filler hard. */

export function CompareChecks() {
  usePageMeta({
    title: "restic check vs borg check vs kopia verify, compared",
    description:
      "What restic check, borg check, and kopia content/snapshot verify actually check by default, what each one's deep-verification flag really does, and the real gotchas in each.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Guide"
        title="restic check vs borg check vs kopia verify, compared"
        lead="All three tools ship a command called some variant of 'check' or 'verify.' None of them mean the same thing by default, and the difference is exactly where people get burned."
      />

      <section class="container legal-body">
        <p>
          The shared trap: every one of these tools has a fast, cheap command that sounds like
          it proves your backup is good, and by default none of them re-read the actual data
          blocks to confirm the bytes are intact. They check structure, that the pieces the
          repository claims to have actually exist and reference each other correctly. That is
          real and worth running. It is not the same claim as "the data in those pieces is still
          correct," and the gap between those two claims is exactly where bit-rot and partial
          uploads hide.
        </p>

        <h2>What the default command actually checks</h2>
        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Default command</th>
                <th>What it verifies by default</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>restic</code></td>
                <td><code>restic check</code></td>
                <td>Index and pack-file structure: every chunk a snapshot references actually exists and the index is internally consistent. Does not re-read pack contents.</td>
              </tr>
              <tr>
                <td><code>borg</code></td>
                <td><code>borg check</code></td>
                <td>Repository consistency and archive metadata consistency: that every chunk an archive references is present. Does not decrypt or checksum chunk contents.</td>
              </tr>
              <tr>
                <td><code>kopia</code></td>
                <td><code>kopia content verify</code></td>
                <td>That every content block referenced by the index actually exists in the repository. Without <code>--full</code>, it doesn't re-hash the block's actual bytes.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          Read that middle column again: all three, by default, are checking that the map is
          internally consistent, not that the territory it points to is still what it claims to
          be. A pack file that's had a handful of bits flip on disk will pass every one of these
          default commands without a complaint.
        </p>

        <h2>The flag that actually re-reads your data</h2>
        <div class="docs-table-wrap">
          <table class="docs-table">
            <thead>
              <tr>
                <th>Tool</th>
                <th>Deep verification</th>
                <th>Granularity</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><code>restic</code></td>
                <td><code>restic check --read-data</code> (everything) or <code>--read-data-subset=5%</code> (a slice)</td>
                <td>Adjustable. You can sample a percentage per run and cover the whole repository over several runs.</td>
              </tr>
              <tr>
                <td><code>borg</code></td>
                <td><code>borg check --verify-data</code></td>
                <td>All or nothing. There's no partial option: it decrypts and CRC-checks every data block, every run.</td>
              </tr>
              <tr>
                <td><code>kopia</code></td>
                <td><code>kopia content verify --full</code>, plus <code>kopia snapshot verify --verify-files-percent=N</code></td>
                <td>Content verify's <code>--full</code> is all-or-nothing at the content layer; snapshot verify has its own separate percentage sampling at the file layer.</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          restic's percentage knob is the most forgiving one to run often: <code>--read-data-subset=5%</code>{" "}
          on a nightly schedule samples the whole repository over roughly a couple of months
          without ever making one run painfully slow or expensive on egress. Borg's design gives
          you no equivalent, it's either a full re-read every time (real cost on a large repo,
          especially against a remote target) or you're back to structural-only checks between
          occasional full ones. Kopia sits in between: <code>content verify --full</code> is
          binary like Borg's, but <code>snapshot verify</code>'s file-percent sampling gives you
          something closer to restic's gradual-coverage approach at the file level.
        </p>

        <h2>The gotcha specific to each tool</h2>
        <ul>
          <li>
            <strong>restic:</strong> the default <code>restic check</code> with no flags is
            genuinely fast and genuinely limited. It's easy to run it, see green, and assume
            you're covered on data integrity when you've only confirmed the index isn't lying to
            itself.
          </li>
          <li>
            <strong>borg:</strong> because <code>--verify-data</code> is all-or-nothing and can
            be slow against a large repository, the honest temptation is to just... not run it,
            and rely on structural checks indefinitely. That's the same trap as restic's default,
            just with a worse excuse, since there's no cheap partial option to fall back to.
          </li>
          <li>
            <strong>kopia:</strong> the sharpest one, and not obvious from the docs: Kopia
            maintains a local metadata cache, and a warm cache can make a verify command report a
            repository as healthy even when the actual remote content is damaged, because it's
            answering from cache rather than actually reaching the backend. Any verification
            command you trust needs to run against a deliberately fresh cache, not whatever
            happens to be sitting on disk from the last run.
          </li>
        </ul>

        <h2>What this means for how often you actually run these</h2>
        <p>
          Structural checks are cheap enough to run on every backup. Full data verification
          usually isn't, which is exactly why so many setups quietly never run it at all past the
          first week. The practical answer isn't "always do the expensive thing," it's picking a
          cadence that actually gets exercised: restic's percentage subset or Kopia's file-percent
          sampling on every run, or Borg's full <code>--verify-data</code> on a slower schedule
          (weekly, monthly) than the plain structural check.
        </p>
        <p>
          This is also the reason a scheduled, alerting check-in matters more than the specific
          command: the tool doesn't fail loudly when you stop running its own verification, it
          just goes back to reporting whatever the last check happened to find. Whichever of
          these three you're on, Vestal's agents run the tool's own deep-verify flag on a schedule
          and only report success when it actually passed, restic with{" "}
          <code>--read-data-subset</code>, Borg with <code>--verify-data</code>, Kopia against a
          fresh cache. See <Link to="/docs">the docs</Link> for the exact setup per tool, or read
          the <Link to="/articles/test-restic-backup-restores">restic restore-testing walkthrough</Link>{" "}
          first if you haven't done this by hand yet.
        </p>
      </section>

      <CtaBand
        title="Whichever of the three you run, the schedule is the part that actually fails."
        sub="One line after your existing backup job. Free to start, no card required."
      />
      <SiteFooter />
    </div>
  );
}
