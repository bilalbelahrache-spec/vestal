/** Formats a unix-seconds timestamp as relative time ("3 minutes ago"), or "never". */
export function relativeTime(unixSeconds: number | null): string {
  if (unixSeconds === null) return "never";
  const deltaSeconds = Math.floor(Date.now() / 1000) - unixSeconds;
  if (deltaSeconds < 5) return "just now";

  const units: [string, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [label, secondsPerUnit] of units) {
    const value = Math.floor(deltaSeconds / secondsPerUnit);
    if (value >= 1) return `${value} ${label}${value === 1 ? "" : "s"} ago`;
  }
  return `${deltaSeconds} second${deltaSeconds === 1 ? "" : "s"} ago`;
}

/** Formats a seconds duration as a human-friendly compact string ("1 day", "90 seconds"). */
export function humanDuration(seconds: number): string {
  const units: [string, number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [label, secondsPerUnit] of units) {
    if (seconds % secondsPerUnit === 0 && seconds >= secondsPerUnit) {
      const value = seconds / secondsPerUnit;
      return `${value} ${label}${value === 1 ? "" : "s"}`;
    }
  }
  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

/** Formats a millisecond duration compactly ("2.3s", "1m 12s") — unlike
 * humanDuration() above, this doesn't require a round multiple of a unit,
 * since real drill/restore durations rarely land on one. Used for restore-
 * drill RTO reporting (see PRO_FEATURES_ROADMAP.md item 5). */
export function humanMs(ms: number): string {
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(totalSeconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return `${hours}h ${remMinutes}m`;
}

export const STATUS_LABELS: Record<string, string> = {
  new: "Not checked in yet",
  pass: "Healthy",
  fail: "Failed",
  late: "Overdue",
};
