import { useRevealGroup } from "../../lib/motion";
import { PageHero, CtaBand } from "../../components/Marketing";
import { SiteFooter } from "../../components/SiteFooter";
import { Link } from "../../router";
import { usePageMeta } from "../../lib/seo";

/* Month 3 content-SEO article, see MARKETING_SEO_PLAN.md Part 3. General
   education, not a Vestal pitch: the mention at the end is earned by the
   "0 errors" point actually needing verification, not forced in. */

export function ThreeTwoOneRule() {
  usePageMeta({
    title: "The 3-2-1 backup rule for a home NAS, explained properly",
    description:
      "What 3-2-1 actually requires, why a NAS with two drives in a mirror isn't 3-2-1 by itself, and the modern 3-2-1-1-0 addendum that's actually the important part.",
  });
  const revealRef = useRevealGroup<HTMLDivElement>();

  return (
    <div ref={revealRef}>
      <PageHero
        eyebrow="Guide"
        title="The 3-2-1 backup rule for a home NAS, explained properly"
        lead="Most explanations stop at the mnemonic. The mnemonic is the easy part; the part people actually get wrong is deciding what counts as a real, separate copy."
      />

      <section class="container legal-body">
        <p>
          3-2-1 is old advice, widely credited to photographer Peter Krogh and later picked up
          by US-CERT as general guidance: keep <strong>3</strong> copies of your data, on{" "}
          <strong>2</strong> different types of media, with <strong>1</strong> of them offsite.
          It's repeated constantly and explained shallowly just as often, usually as three numbers
          with no discussion of what actually satisfies each one. That's the part that matters,
          because it's entirely possible to own three drives full of your data and still have
          zero real backups.
        </p>

        <h2>"3 copies" means the original plus two backups, not three backups</h2>
        <p>
          The live data you use every day counts as one of the three. If you have your NAS and
          nothing else, you have one copy. Add a second NAS mirroring the first and you have two.
          You need one more beyond that, and it needs to actually be independent (see below), to
          reach three.
        </p>

        <h2>The trap: RAID is not a backup, and two drives isn't "2 different media"</h2>
        <p>
          This is where most home setups quietly fail the rule while feeling well-protected. A
          NAS running RAID 1 or RAID 5 protects you against a single drive dying. It does nothing
          for the failure modes that actually destroy people's data: accidental deletion, a
          ransomware payload that reaches the NAS over the network and encrypts everything on it,
          a bad firmware update, a power surge that takes out the whole enclosure, or the NAS
          itself being stolen. RAID is uptime insurance for one copy, not a second copy. A NAS
          with redundant drives is still one copy in the 3-2-1 sense, however many physical disks
          are inside it.
        </p>
        <p>
          The same logic applies to "2 different media." The point was never literally about
          disk versus tape versus optical. It's about failure independence: would the same event
          (a house fire, a burst pipe, a single ransomware run, one enclosure's firmware bug)
          plausibly take out both copies at once? Two NAS boxes from the same vendor, same
          firmware, sitting on the same shelf, connected to the same network, share almost every
          failure mode that actually matters. That's better than one copy, but it's not the
          independence the rule is actually asking for.
        </p>

        <h2>"1 offsite" means "not destroyable by the same event," not just "a different room"</h2>
        <p>
          A second NAS in a different room of the same house satisfies "different media" better
          than it satisfies "offsite." Fire, flood, theft, and a lot of ransomware (anything that
          can reach the second device over the same local network) don't respect room boundaries.
          Real offsite is a genuinely separate location: a relative's house, a safety deposit box
          for a drive you rotate, or, for almost everyone reading this, encrypted cloud storage
          (B2, S3, or similar) that a local incident physically cannot touch.
        </p>
        <p>
          Cloud <em>sync</em> is not the same thing as cloud backup, and this is the single most
          common home-NAS mistake. A sync service (Dropbox, Google Drive, a NAS's own cloud-sync
          app) faithfully replicates whatever happens locally, including a file getting encrypted
          by ransomware or accidentally deleted. Depending on the service's version history and
          retention window, that may or may not be recoverable, and most people find out which
          one only after it's too late to matter. A real backup tool (restic, Borg, Kopia,
          Duplicati) takes independent, dated snapshots on its own schedule, specifically so that
          "the live copy got destroyed" doesn't propagate into "the backup got destroyed too."
        </p>

        <h2>The addendum that's actually the important part: 3-2-1-1-0</h2>
        <p>
          A lot of practitioners have extended the original rule for good reason:
        </p>
        <ul>
          <li>
            <strong>+1 immutable or offline copy</strong>: at least one copy that ransomware
            running on your live systems cannot reach or alter, whether that's a drive that's
            physically disconnected between backup runs or a cloud target with object-lock/
            immutability enabled.
          </li>
          <li>
            <strong>0 errors</strong>: confirmed, not assumed. This is the number almost every
            home setup silently fails, because confirming it means actually testing a restore or
            running your backup tool's own deep verification, and almost nobody does either on a
            schedule.
          </li>
        </ul>
        <p>
          That last number is the whole rule's actual weak point in practice. Someone can get "3
          copies, 2 media, 1 offsite, 1 immutable" completely right and still be trusting three
          copies of silently corrupted data, because none of the first four numbers say anything
          about whether the backups are still good. A repository with bit-rot, a truncated
          upload, or a corrupted index will happily exist in three places, on two kinds of media,
          with one offsite, and still fail you the day you need it.
        </p>

        <h2>What a reasonable home-NAS setup actually looks like</h2>
        <ol class="docs-steps">
          <li>
            <h3>Copy 1: the live NAS</h3>
            <p>RAID for uptime if you like, but understood as one copy, not a backup strategy.</p>
          </li>
          <li>
            <h3>Copy 2: a second, genuinely separate local target</h3>
            <p>
              An external drive you connect to back up then disconnect, or a second device from a
              different vendor. The goal is a different failure domain, not just a different box.
            </p>
          </li>
          <li>
            <h3>Copy 3: offsite, via an actual backup tool</h3>
            <p>
              restic, Borg, Kopia, or Duplicati, encrypted, to cloud object storage. This is the
              copy that survives the house.
            </p>
          </li>
          <li>
            <h3>The "0" everyone skips</h3>
            <p>
              Whichever tool you picked has its own real data-verification command (see{" "}
              <Link to="/articles/compare-check-commands">
                how restic, Borg, and Kopia's own verify commands compare
              </Link>
              ), and it needs to actually run on a schedule you don't have to remember, with
              something that tells you loudly the moment it stops passing. That's the exact gap{" "}
              <Link to="/">Vestal</Link> exists to close: a dead-man's switch that only reports
              success when the backup tool's own deep verification actually passed. See{" "}
              <Link to="/docs">the docs</Link> for setup, five minutes per repository.
            </p>
          </li>
        </ol>
      </section>

      <CtaBand
        title="3 copies, 2 media, 1 offsite gets you most of the way. The 0 is the part nobody checks."
        sub="One line after your existing backup job. Free to start, no card required."
      />
      <SiteFooter />
    </div>
  );
}
