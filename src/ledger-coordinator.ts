/**
 * Serializes verification-ledger appends for ONE user's hash chain — see
 * PRO_FEATURES_ROADMAP.md item 4 and migrations/0011_verification_ledger.sql's
 * comment on the race this closes.
 *
 * The race: appending an entry is read-last-hash, then insert-new-entry —
 * two separate D1 calls. If the same user's two checks ping in the same
 * instant, both requests could read the same "last hash" and both insert
 * an entry claiming to chain from it, forking the chain.
 *
 * The fix is routing (see `env.LEDGER_COORDINATOR.idFromName(userId)` in
 * src/index.ts): every append for a given user's chain is routed to the
 * SAME Durable Object instance, and a DO instance's JavaScript runs
 * single-threaded in one isolate. That alone is necessary but NOT
 * sufficient, though: Durable Objects' automatic input/output gating only
 * covers `this.ctx.storage` operations. The D1 calls this needs
 * (`getLastLedgerHash`/`appendLedgerEntry` in src/db.ts) go through the
 * `DB` binding, which is external I/O exactly like an outgoing `fetch()` —
 * NOT covered by that automatic gating. Without something explicit, two
 * concurrent RPC calls to this same instance could still interleave
 * between the read and the write (request A reads the last hash, yields
 * on the await, request B reads the same last hash before A has written
 * its entry, both proceed to insert against the same prev_hash).
 *
 * The `queue` promise chain below is that "something explicit": every
 * call chains onto the same instance-local promise, so request N's full
 * read -> sign -> write sequence completes before request N+1's sequence
 * starts. Deliberately NOT `blockConcurrencyWhile()` (flagged as an
 * anti-pattern for exactly this "hold it across external I/O on every
 * request" shape) — the queue gets the same one-at-a-time guarantee
 * without blocking ALL input to the DO on every single call.
 */
import { DurableObject } from "cloudflare:workers";
import { appendLedgerEntry, getLastLedgerHash, type LedgerEntryRow } from "./db";
import { hashEntry, importSigningPrivateKey, signEntryHash, type LedgerEntryContent } from "./ledger";
import type { Env } from "./types";
import { nowSeconds, uuid } from "./util";

export interface AppendLedgerEntryInput {
  userId: string;
  checkId: string;
  checkName: string;
  backend: string;
  status: "pass" | "fail";
  message: string | null;
}

export interface AppendLedgerEntryResult {
  entryHash: string;
  prevHash: string | null;
}

export class LedgerCoordinator extends DurableObject<Env> {
  /** Instance-local serialization point — see the file-level comment for
   * why this exists and why it's not `blockConcurrencyWhile()`. Every
   * call chains onto this so calls can never interleave, regardless of
   * how many arrive concurrently for this same user. */
  private queue: Promise<unknown> = Promise.resolve();

  async appendLedgerEntry(input: AppendLedgerEntryInput): Promise<AppendLedgerEntryResult> {
    const result = this.queue.then(() => this.doAppend(input));
    // Swallow here so one failed append doesn't permanently wedge the
    // queue for subsequent, unrelated calls — the real error still
    // propagates to this call's own caller via `result` below.
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async doAppend(input: AppendLedgerEntryInput): Promise<AppendLedgerEntryResult> {
    const env = this.env;
    if (!env.LEDGER_SIGNING_PRIVATE_KEY) {
      throw new Error("LEDGER_SIGNING_PRIVATE_KEY not configured");
    }

    // Preserved exactly from the original maybeAppendLedgerEntry: prevHash
    // is null only for a user's very first ledger entry ever, and that
    // falls out naturally here — same getLastLedgerHash call, same
    // null-when-no-rows-yet behavior, just now serialized per user.
    const prevHash = await getLastLedgerHash(env, input.userId);
    const entry: LedgerEntryContent = {
      id: uuid(),
      user_id: input.userId,
      check_id: input.checkId,
      check_name: input.checkName,
      backend: input.backend,
      status: input.status,
      message: input.message,
      prev_hash: prevHash,
      created_at: nowSeconds(),
    };
    const entryHash = await hashEntry(entry);
    const privateKey = await importSigningPrivateKey(env.LEDGER_SIGNING_PRIVATE_KEY);
    const signature = await signEntryHash(entryHash, privateKey);

    const row: LedgerEntryRow = { ...entry, entry_hash: entryHash, signature };
    await appendLedgerEntry(env, row);

    return { entryHash, prevHash };
  }
}
