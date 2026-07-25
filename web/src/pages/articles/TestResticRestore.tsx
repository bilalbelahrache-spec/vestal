import { useRevealGroup } from "../../lib/motion";
import { PageHero, CtaBand } from "../../components/Marketing";
import { SiteFooter } from "../../components/SiteFooter";
import { Link } from "../../router";
import { usePageMeta } from "../../lib/seo";

/* Month 1 content-SEO article, see MARKETING_SEO_PLAN.md Part 3. Targets
   the exact long-tail query someone types after `restic backup` says
   "success" but they've never actually tried getting the data back. */

export function TestResticRestore() {
  usePageMeta({
    title: "How to actually test that a restic backup restores",
    description:
      "restic backup exiting 0 doesn't mean the repository is restorable. A concrete, five-minute way to actually prove it, plus what to automate once you've done it by hand.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Guide"
        title="How to actually test that a restic backup restores"
        lead="restic backup exited 0. Your cron job says success. Neither of those is the claim you actually care about."
      />

      <section class="container legal-body">
        <p>
          If you've never done this, you don't actually know your backup works. That's not an
          insult, it's just true of almost everyone running <code>restic backup /srv/data</code>{" "}
          on a timer and moving on with their life. The job finishing without an error tells you
          the write succeeded. It tells you nothing about whether the data you'd need six months
          from now, at 2am, during an actual incident, can be read back out.
        </p>

        <h2>The three things that can go wrong, silently</h2>
        <ul>
          <li>
            <strong>The pack files are fine, the index isn't.</strong> restic separates the
            content from the metadata that tells it where the content lives. A corrupted index
            can leave every pack file intact and still make a restore fail or return garbage.
          </li>
          <li>
            <strong>Bit rot.</strong> A block on disk (yours or your remote's) flips a few bits
            months after the backup ran. Nothing touched the file, nothing logged an error, and
            <code>restic backup</code> never re-reads old snapshots to notice.
          </li>
          <li>
            <strong>A truncated upload.</strong> A flaky connection to S3, B2, or an SFTP target
            can leave a pack file partially written. restic's default check only looks at
            structure, not contents, so this can sit undetected indefinitely.
          </li>
        </ul>
        <p>
          All three produce the same symptom: a backup job that has been reporting success for
          months, and a restore that fails on the one day it matters.
        </p>

        <h2>The five-minute version, right now</h2>
        <p>
          Don't restore your production data over itself. Pick a snapshot and restore it
          somewhere throwaway, then actually look at what came out.
        </p>
        <pre class="code-block">{`# list snapshots, pick one
restic -r /path/to/repo snapshots

# restore it somewhere disposable, not over the original
restic -r /path/to/repo restore latest --target /tmp/restore-test

# now actually look:
diff -rq /tmp/restore-test/srv/data /srv/data   # do the files match what's live?
# for a database dump specifically, go further: actually import it
# into a throwaway database and query it, not just check the file exists.`}</pre>
        <p>
          That last line matters more than it looks. A file existing and being byte-identical to
          what you expect is necessary but not sufficient for the things people actually restore
          under pressure, database dumps, VM disk images, anything with its own internal
          structure. A restore test that stops at "the file is there" catches fewer real failures
          than one that opens the file and confirms it's usable.
        </p>

        <h2>The deeper check restic ships and almost nobody runs</h2>
        <p>
          <code>restic check</code> validates repository structure: that the index matches the
          pack files, that nothing referenced is missing. That's real and worth running, but by
          default it does not re-read the actual data blocks, which means it can pass clean on a
          repository with silently corrupted content. The flag that closes that gap:
        </p>
        <pre class="code-block">{`# structure only, fast, catches missing/orphaned data
restic -r /path/to/repo check

# re-reads and verifies a real percentage of actual pack data
# slower, but it's the only thing that catches bit rot directly
restic -r /path/to/repo check --read-data-subset=5%`}</pre>
        <p>
          Running <code>--read-data-subset</code> at something like 5% on a schedule, so that
          over a couple of months you've sampled the whole repository, is a genuinely good middle
          ground between "never verify data" and "re-read everything every night," which is often
          too slow or too expensive in egress to run constantly.
        </p>

        <h2>Doing this by hand once is good. Doing it by hand every month is the part that fails</h2>
        <p>
          The honest failure mode here isn't ignorance, it's that manual restore testing is
          tedious, and tedious things that don't visibly reward you get skipped after the second
          or third time. The actual fix isn't "try harder to remember." It's moving the check
          somewhere it runs whether or not you remember, and somewhere that tells you loudly the
          moment it stops passing, not the day you go looking for a restore.
        </p>
        <p>
          That's the exact gap{" "}
          <Link to="/">Vestal</Link>'s restic agent is built to close: it runs{" "}
          <code>restic check</code>, optionally with{" "}
          <code>--read-data-subset</code>, right after your existing backup job, and only reports
          success when the repository itself proves sound, not when the job merely finishes. See{" "}
          <Link to="/docs">the docs</Link> for the five-minute setup, or{" "}
          <Link to="/pricing">pricing</Link> if you're just checking what's actually free (the
          core verification and alerting is, permanently). If you're also running Borg or Kopia,{" "}
          <Link to="/articles/compare-check-commands">
            here's how their own check commands compare
          </Link>.
        </p>
      </section>

      <CtaBand
        title="You just read how to check this by hand. Now make it automatic."
        sub="One line after your existing restic backup command. Free to start, no card required."
      />
      <SiteFooter />
    </div>
  );
}
