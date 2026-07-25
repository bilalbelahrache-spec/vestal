import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { useToast } from "../context/toast";
import type { LedgerEntry, LedgerSummary } from "../types";
import { relativeTime } from "../format";

/** Lazily-loaded browse view — entries are only fetched the first time
 * "Browse entries" is expanded, same pattern as CheckList's detail panels
 * (config-audit findings, flagged archive files). Shows recent-first,
 * capped, since a long-lived heavy account's chain could in principle be
 * large — full history is always available via the export buttons below,
 * this is a quick "what's actually in here" look, not a replacement. */
function LedgerEntriesBrowser() {
  const { showError } = useToast();
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);

  const BROWSE_LIMIT = 25;

  useEffect(() => {
    api
      .ledgerEntries()
      .then(setEntries)
      .catch((err) => {
        showError(err instanceof ApiError ? err.message : "Couldn't load ledger entries.");
        setEntries([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (entries === null) {
    return <p class="detail-panel-loading">Loading ledger entries…</p>;
  }

  if (entries.length === 0) {
    return <p class="detail-panel-loading">No verification entries recorded yet.</p>;
  }

  const shown = entries.slice(0, BROWSE_LIMIT);

  return (
    <div class="ledger-browse">
      <table class="ledger-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Check</th>
            <th>Backend</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.id}>
              <td>{relativeTime(e.created_at)}</td>
              <td>{e.check_name}</td>
              <td>{e.backend}</td>
              <td>
                <span class={`status-badge ${e.status === "pass" ? "status-pass" : "status-fail"}`}>
                  {e.status === "pass" ? "Passed" : "Failed"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {entries.length > BROWSE_LIMIT && (
        <p class="detail-panel-loading">
          Showing the {BROWSE_LIMIT} most recent of {entries.length} entries — export below for the full chain.
        </p>
      )}
    </div>
  );
}

/** The ledger export button used to be the only thing here — this adds a
 * live summary (entry count, last-verified time, self-check status) so
 * "does this actually have anything in it" doesn't require downloading the
 * export just to find out, plus an in-dashboard browse view and a CSV
 * export alongside the original JSON one. */
export function LedgerPanel() {
  const [summary, setSummary] = useState<LedgerSummary | null>(null);
  const [browsing, setBrowsing] = useState(false);

  useEffect(() => {
    api
      .ledgerSummary()
      .then(setSummary)
      .catch(() => setSummary(null));
  }, []);

  return (
    <section>
      <h2>Verification ledger</h2>
      <p class="section-hint">
        A cryptographically signed, tamper-evident record of every completed backup verification —
        suitable for a cyber-insurance underwriter or an auditor. Unlike the data export above, this
        one can be independently checked by anyone, without trusting Vestal's word for it: see{" "}
        <a href="https://github.com/bilalbelahrache-spec/vestal/blob/master/docs/verifying-the-ledger.md">
          how to verify it yourself
        </a>
        .
      </p>
      {summary && summary.configured && (
        <dl class="check-meta">
          <dt>Entries recorded</dt>
          <dd>{summary.entry_count}</dd>
          <dt>Most recent</dt>
          <dd>{relativeTime(summary.latest_entry_at)}</dd>
          {summary.self_check && (
            <>
              <dt>Chain self-check</dt>
              <dd>
                <span class={`status-badge ${summary.self_check.valid ? "status-pass" : "status-fail"}`}>
                  {summary.self_check.valid ? "Valid" : "Failed"}
                </span>
                {!summary.self_check.valid && summary.self_check.reason && ` — ${summary.self_check.reason}`}
              </dd>
            </>
          )}
        </dl>
      )}
      <div class="ledger-actions">
        <button type="button" class="btn-secondary" onClick={() => setBrowsing((v) => !v)}>
          {browsing ? "Hide entries" : "Browse entries"}
        </button>
        <a class="btn-secondary" href="/api/ledger/export" download>
          Export as JSON
        </a>
        <a class="btn-secondary" href="/api/ledger/export.csv" download>
          Export as CSV
        </a>
        <a class="btn-secondary" href="/api/ledger/export.pdf" download>
          Export as PDF
        </a>
      </div>
      {browsing && (
        <div class="detail-panel">
          <LedgerEntriesBrowser />
        </div>
      )}
    </section>
  );
}
