import { test, expect } from "@playwright/test";
import { scoreAnomaly } from "../src/anomaly";
import type { DiffStatSample } from "../src/types";

// Pure-logic tests, no running server needed (unlike admin.spec.ts/
// e2e.spec.ts) — scoreAnomaly() has no D1/Worker dependency. The fixture
// numbers below aren't invented: they're the real `restic diff` output
// from an actual local repo (2026-07-24) — five ordinary small-edit
// snapshots, then one where every file was renamed with a ".locked"
// extension appended (the classic ransomware pattern). That test caught a
// real design bug before this shipped: scoring on `files_changed` alone
// (the first draft) scored the ransomware run as ZERO change, because
// restic represents a rename as a delete+add of two different paths, not
// a "changed" file — see totalChurn()'s comment in src/anomaly.ts.

const normalRuns: DiffStatSample[] = [
  { files_added: 1, files_removed: 0, files_changed: 2, ext_change_count: 0 },
  { files_added: 1, files_removed: 0, files_changed: 2, ext_change_count: 0 },
  { files_added: 1, files_removed: 0, files_changed: 2, ext_change_count: 0 },
  { files_added: 1, files_removed: 0, files_changed: 2, ext_change_count: 0 },
  { files_added: 1, files_removed: 0, files_changed: 2, ext_change_count: 0 },
];
const ransomwareRun: DiffStatSample = {
  files_added: 50,
  files_removed: 50,
  files_changed: 0,
  ext_change_count: 50,
};

test("does not score or flag until there's enough baseline history", () => {
  for (let i = 0; i < 4; i++) {
    const result = scoreAnomaly(normalRuns.slice(0, i), normalRuns[i]);
    expect(result.score).toBeNull();
    expect(result.isAnomalous).toBe(false);
  }
});

test("a run identical to its own baseline never flags", () => {
  const result = scoreAnomaly(normalRuns, normalRuns[0]);
  expect(result.isAnomalous).toBe(false);
});

test("the real ransomware-simulated diff is flagged against the real normal baseline", () => {
  const result = scoreAnomaly(normalRuns, ransomwareRun);
  expect(result.isAnomalous).toBe(true);
});

test("an extreme volume spike with no extension signal still eventually flags", () => {
  // Same flat baseline as above (mean churn 3, zero variance) — a run more
  // than 10 above the mean clears the higher volume-only bar even with no
  // rename signal, since some ransomware overwrites content in place
  // without renaming files at all.
  const extremeNoExt: DiffStatSample = { files_added: 40, files_removed: 0, files_changed: 10, ext_change_count: 0 };
  const result = scoreAnomaly(normalRuns, extremeNoExt);
  expect(result.isAnomalous).toBe(true);
});

test("a moderate volume change with no extension signal does not false-positive, but the same volume WITH a signal does", () => {
  // Baseline with realistic natural variance (not the degenerate
  // zero-variance case above) — mean churn 6.2, sd ~0.98.
  const variedBaseline: DiffStatSample[] = [
    { files_added: 2, files_removed: 0, files_changed: 3, ext_change_count: 0 },
    { files_added: 1, files_removed: 1, files_changed: 5, ext_change_count: 0 },
    { files_added: 3, files_removed: 0, files_changed: 2, ext_change_count: 0 },
    { files_added: 1, files_removed: 0, files_changed: 6, ext_change_count: 0 },
    { files_added: 2, files_removed: 1, files_changed: 4, ext_change_count: 0 },
  ];
  // z ~= 3.9 against this baseline: above the ext-signal threshold (3),
  // below the volume-only threshold (6) — deliberately chosen to land
  // between the two, so this pair of assertions actually exercises the
  // distinction the two thresholds exist to draw.
  const moderateChange: DiffStatSample = { files_added: 8, files_removed: 0, files_changed: 2, ext_change_count: 0 };
  const withoutSignal = scoreAnomaly(variedBaseline, moderateChange);
  expect(withoutSignal.isAnomalous).toBe(false);

  const sameVolumeWithSignal: DiffStatSample = { ...moderateChange, ext_change_count: 8 };
  const withSignal = scoreAnomaly(variedBaseline, sameVolumeWithSignal);
  expect(withSignal.isAnomalous).toBe(true);
});
