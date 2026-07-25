import type { CheckWithPingUrl } from "../types";
import { relativeTime } from "../format";

/**
 * Dedicated archive-health section — see PRO_FEATURES_ROADMAP.md item 2's
 * "not yet built" note. Until now, an archive check's status lived only as
 * a badge buried in the generic check-card list (see CheckList.tsx); this
 * pulls every 'archive' backend check into its own summary with the two
 * things the roadmap called out as needing to be front and center:
 * last-verified date (bit rot is only useful to catch if you know how
 * fresh the last scan was) and the flat-price pitch against the
 * $3,000-9,600/year enterprise equivalent (see PRO_FEATURES_ROADMAP.md
 * item 2's own cited pricing) — a large archive is exactly the case where
 * that contrast is most persuasive, so it's stated in dollar terms here,
 * not just "flat pricing" as an abstract claim.
 *
 * Renders nothing when the user has no archive checks — this is meant to
 * be a highlight for people actually using the feature, not empty-state
 * clutter for everyone else.
 */
export function ArchiveHealthPanel({ checks }: { checks: CheckWithPingUrl[] }) {
  const archiveChecks = checks.filter((c) => c.backend === "archive");
  if (archiveChecks.length === 0) return null;

  const totalFlagged = archiveChecks.reduce((sum, c) => sum + c.flagged_archive_file_count, 0);

  return (
    <section class="archive-health">
      <h2>Archive integrity</h2>
      <p class="section-hint">
        Independent bit-rot monitoring for cold/archival data — flat-priced regardless of archive size,
        unlike the $3,000-9,600/year continuous-verification tier enterprise backup vendors charge for a
        20TB archive. Vestal never stores your files, only their hashes, so there's no storage-based bill
        to scale with.
      </p>
      {totalFlagged > 0 && (
        <p class="archive-health-alert">
          ⚠ {totalFlagged} file{totalFlagged === 1 ? "" : "s"} across {archiveChecks.length === 1 ? "this archive" : "your archives"}{" "}
          {totalFlagged === 1 ? "is" : "are"} currently flagged as possible corruption — see the check
          {archiveChecks.length === 1 ? "" : "s"} below for details.
        </p>
      )}
      <div class="archive-health-grid">
        {archiveChecks.map((c) => (
          <div key={c.id} class={`archive-health-card${c.flagged_archive_file_count > 0 ? " is-flagged" : ""}`}>
            <h3>{c.name}</h3>
            <dl class="check-meta">
              <dt>Last scanned</dt>
              <dd>{relativeTime(c.last_ping_at)}</dd>
              <dt>Status</dt>
              <dd>
                {c.flagged_archive_file_count > 0
                  ? `${c.flagged_archive_file_count} file${c.flagged_archive_file_count === 1 ? "" : "s"} flagged`
                  : "No corruption detected"}
              </dd>
            </dl>
          </div>
        ))}
      </div>
    </section>
  );
}
