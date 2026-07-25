import { useRevealGroup } from "../../lib/motion";
import { PageHero, CtaBand } from "../../components/Marketing";
import { SiteFooter } from "../../components/SiteFooter";
import { Link } from "../../router";
import { usePageMeta } from "../../lib/seo";

/* Month 4 content-SEO article, see MARKETING_SEO_PLAN.md Part 3. Closest to
   Vestal's actual core pitch, deliberately published after three
   credibility-building technical pieces rather than first. */

export function ExitCodeZero() {
  usePageMeta({
    title: "Why your backup job succeeding doesn't mean your data is safe",
    description:
      "Four real, specific ways a backup job can report success while the data underneath is already unrestorable, and what actually closes each gap.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Guide"
        title="Why your backup job succeeding doesn't mean your data is safe"
        lead="'The command finished' and 'the data is restorable' are two different claims. Every backup tool's default output only makes the first one."
      />

      <section class="container legal-body">
        <p>
          This isn't a criticism of restic, Borg, Kopia, or Duplicati. All four are genuinely
          good software. It's a description of what "success" is actually claiming, which is
          narrower than most people assume: the process ran, wrote data, and exited without an
          error it detected. None of that is nothing, but none of it is "you could restore from
          this today," either. Here are four specific, real ways the gap between those two claims
          shows up, not hypotheticals.
        </p>

        <h2>1. The job stops running, and nothing notices</h2>
        <p>
          A server reboots and the systemd timer doesn't re-arm. A cron entry survives a path
          change to something that no longer exists. A credential expires and the job starts
          failing at a step before it would ever produce an exit code at all. In every one of
          these cases, there's no failure to alert on, because there's no run. The last known-good
          backup sits there looking exactly as valid as it did the day it was taken, while the
          live data underneath it drifts further away with every day that passes. Nothing about
          "did the last backup succeed" catches this, because the question that actually matters
          is "did a backup happen recently at all," and that requires something watching the
          calendar, not the exit code.
        </p>

        <h2>2. The repository looks structurally fine and isn't</h2>
        <p>
          Every one of these tools ships a default check command, and every one of those default
          commands validates structure rather than content: that the index is internally
          consistent, that everything a snapshot references actually exists. None of them re-read
          and verify the actual data bytes unless you ask for that specifically, because doing so
          is slow and, against a remote target, genuinely expensive in bandwidth. Bit-rot, a
          handful of flipped bits from an aging drive or a flaky remote store, passes every
          default structural check without complaint. The backup job keeps reporting success. The
          rot just sits there until a restore tries to read the damaged block.
        </p>

        <h2>3. The tool's own convenience feature works against you</h2>
        <p>
          Two real, specific examples, not abstractions. Kopia keeps a local metadata cache for
          performance, and a warm cache can make a verify command report a repository healthy by
          answering from cache instead of actually reaching the backend, even when the real
          remote content is damaged. Duplicati's default retry behavior, meant to ride out
          transient network blips, turns a genuinely broken backend into a multi-minute hang
          instead of a fast, loud failure, so the thing that's supposed to protect you against
          flakiness quietly buries the one failure you actually needed to hear about immediately.
          Both are sensible defaults for the common case. Both work directly against you in the
          uncommon case that matters most.
        </p>

        <h2>4. The configuration is wrong in a way that never throws an error</h2>
        <p>
          A retention policy with every <code>--keep-*</code> count accidentally set to zero
          prunes everything and reports success at every step, because from the tool's
          perspective nothing went wrong, you asked it to keep nothing and it complied. A pruning
          step that silently stops working (a permissions issue, a lock it can't acquire) leaves
          old snapshots piling up while the backup step keeps succeeding, giving no indication
          that half your stated retention policy has quietly stopped applying. Neither of these is
          a bug in the backup tool. Both are real, and both are invisible to "did the job exit
          cleanly."
        </p>

        <h2>What actually closes each gap</h2>
        <p>
          Not one thing, four, matching the four problems above: a schedule watchdog that notices
          absence, not just failure. The tool's own deep-verification flag, actually run
          (<code>restic check --read-data-subset</code>, <code>borg check --verify-data</code>,{" "}
          <code>kopia content verify --full</code> against a fresh cache), not just the fast
          default. Tool-specific handling of the exact footguns above, retries disabled for
          Duplicati, a fresh cache directory for Kopia every run. And a read on the actual
          declared retention policy, not just whether the backup step reported success.
        </p>
        <p>
          That's the complete list of what <Link to="/">Vestal</Link>'s agents actually do,
          described plainly rather than as a feature list: one dead-man's switch that understands
          schedules, one call to each tool's own real verification command, the specific
          workarounds for the specific footguns above, and a read on the retention policy you
          declared. None of it is exotic. All of it is the difference between "the job finished"
          and the claim that's actually worth trusting. See{" "}
          <Link to="/docs">the docs</Link> for the five-minute setup per tool, or start with{" "}
          <Link to="/articles/test-restic-backup-restores">
            testing a restic restore by hand
          </Link>{" "}
          first if you want to see problem #2 for yourself before automating the check for it.
        </p>
      </section>

      <CtaBand
        title="Exit code 0 was never the claim you actually needed."
        sub="One line after your existing backup job. Free to start, no card required."
      />
      <SiteFooter />
    </div>
  );
}
