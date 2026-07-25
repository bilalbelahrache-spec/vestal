/** Shimmering placeholder blocks shown while checks/alert-channels are
 * still loading — replaces a static "Loading…" line so the dashboard
 * never shows a dead frame between navigation and data arriving. */
export function CardSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div class="skeleton-grid" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div class="skeleton-card" key={i}>
          <div class="skeleton-line w-40" />
          <div class="skeleton-line w-70" />
          <div class="skeleton-line w-90" />
        </div>
      ))}
    </div>
  );
}
