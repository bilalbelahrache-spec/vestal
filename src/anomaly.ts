import type { DiffStatSample } from "./types";

// Below this many prior samples there isn't enough history to know what
// "normal" looks like for this specific check — scoring would just be
// noise off a tiny sample. Runs are still recorded below this count (they
// need to exist to eventually BECOME the baseline), just not scored.
const MIN_BASELINE_SAMPLES = 5;

// Two thresholds, not one — verified necessary against real restic output
// (2026-07-24): a mass-rename (files_added + files_removed both spike,
// files_changed stays 0, and the renamed files share a suspicious extension
// pattern — see totalChurn()'s comment) is much stronger ransomware
// evidence than volume alone, so it clears the bar at a lower z-score.
// Pure volume with no rename/extension signal (a legitimate bulk
// reorganize can look like this too) needs a much bigger deviation before
// it's worth surfacing at all.
const Z_SCORE_THRESHOLD_WITH_EXT_SIGNAL = 3;
const Z_SCORE_THRESHOLD_VOLUME_ONLY = 6;

// A large FINITE stand-in for "unboundedly anomalous" (the zero-variance
// fallback below). Verified against a real local D1 run (2026-07-24) that
// literal Infinity silently becomes NULL once round-tripped through
// SQLite/D1's REAL column type — this score gets persisted (see
// db.ts's recordDiffStats/markAnomaly) and shown to a user, so it has to
// survive storage, not just the in-memory comparison.
const MAX_FINITE_SCORE = 99;

export interface AnomalyResult {
  /** null = not enough baseline history yet to score this run at all. */
  score: number | null;
  isAnomalous: boolean;
}

/** Total file churn for one run. Deliberately NOT just `files_changed` —
 * verified against a real restic repo (2026-07-24) that a mass rename
 * (the classic ransomware pattern: photo.jpg -> photo.jpg.locked) shows up
 * as `files_added` + `files_removed` with `files_changed` at ZERO, since
 * restic tracks by path and a rename is a different path. Scoring on
 * files_changed alone would have missed exactly the case this feature
 * exists to catch. */
function totalChurn(s: DiffStatSample): number {
  return s.files_changed + s.files_added + s.files_removed;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stddev(xs: number[], m: number): number {
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / xs.length;
  return Math.sqrt(variance);
}

/**
 * Scores a new diff-stat sample against a check's own rolling history —
 * see migrations/0008's comment for why a per-check baseline matters more
 * than a single global threshold. `history` should be the check's most
 * recent prior samples (any order), NOT including `current`.
 */
export function scoreAnomaly(history: DiffStatSample[], current: DiffStatSample): AnomalyResult {
  if (history.length < MIN_BASELINE_SAMPLES) {
    return { score: null, isAnomalous: false };
  }

  const churns = history.map(totalChurn);
  const m = mean(churns);
  const sd = stddev(churns, m);
  const currentChurn = totalChurn(current);

  // A baseline with zero variance (every prior run churned exactly the
  // same amount) makes the usual z-score formula divide by zero — treat a
  // meaningfully larger run as an effectively unbounded deviation instead.
  // "Meaningfully larger" still requires clearing a real absolute floor
  // (currentChurn - m > 10), not just "one more file than always," so a
  // quiet check with near-zero normal churn doesn't flag on noise.
  const z = sd === 0 ? (currentChurn - m > 10 ? MAX_FINITE_SCORE : 0) : (currentChurn - m) / sd;

  const threshold = current.ext_change_count > 0
    ? Z_SCORE_THRESHOLD_WITH_EXT_SIGNAL
    : Z_SCORE_THRESHOLD_VOLUME_ONLY;
  const isAnomalous = z >= threshold;

  return { score: z, isAnomalous };
}
