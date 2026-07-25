import { test, expect } from "@playwright/test";
import {
  hashEntry,
  signEntryHash,
  verifyEntrySignature,
  verifyLedgerChain,
  type LedgerEntryContent,
} from "../src/ledger";

// All crypto below is REAL — a real Ed25519 keypair generated fresh per
// test run via the actual Web Crypto API (confirmed working against both
// Node and, separately, a real wrangler dev instance, 2026-07-24), real
// SHA-256 hashing, real signatures. Nothing here is mocked.

async function realKeyPair() {
  const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  return keyPair;
}

function makeEntry(overrides: Partial<LedgerEntryContent> = {}): LedgerEntryContent {
  return {
    id: "entry-1",
    user_id: "user-1",
    check_id: "check-1",
    check_name: "nightly-backup",
    backend: "restic",
    status: "pass",
    message: "restic check passed",
    prev_hash: null,
    created_at: 1784800000,
    ...overrides,
  };
}

test("hashing the same entry content twice produces the same hash", async () => {
  const entry = makeEntry();
  const h1 = await hashEntry(entry);
  const h2 = await hashEntry(entry);
  expect(h1).toBe(h2);
  expect(h1).toMatch(/^[0-9a-f]{64}$/);
});

test("changing any single field changes the hash", async () => {
  const base = await hashEntry(makeEntry());
  expect(await hashEntry(makeEntry({ status: "fail" }))).not.toBe(base);
  expect(await hashEntry(makeEntry({ message: "different message" }))).not.toBe(base);
  expect(await hashEntry(makeEntry({ created_at: 1784800001 }))).not.toBe(base);
  expect(await hashEntry(makeEntry({ prev_hash: "abc123" }))).not.toBe(base);
});

test("a real signature verifies against the real matching public key, and fails against a different one", async () => {
  const keyPair = await realKeyPair();
  const otherKeyPair = await realKeyPair();
  const hash = await hashEntry(makeEntry());
  const signature = await signEntryHash(hash, keyPair.privateKey);

  expect(await verifyEntrySignature(hash, signature, keyPair.publicKey)).toBe(true);
  expect(await verifyEntrySignature(hash, signature, otherKeyPair.publicKey)).toBe(false);
});

test("a real 3-entry chain verifies end to end", async () => {
  const keyPair = await realKeyPair();

  const e1 = makeEntry({ id: "e1", prev_hash: null, created_at: 1784800000 });
  const e1Hash = await hashEntry(e1);
  const e1Signed = { ...e1, entry_hash: e1Hash, signature: await signEntryHash(e1Hash, keyPair.privateKey) };

  const e2 = makeEntry({ id: "e2", prev_hash: e1Hash, created_at: 1784800001, status: "fail" as const });
  const e2Hash = await hashEntry(e2);
  const e2Signed = { ...e2, entry_hash: e2Hash, signature: await signEntryHash(e2Hash, keyPair.privateKey) };

  const e3 = makeEntry({ id: "e3", prev_hash: e2Hash, created_at: 1784800002 });
  const e3Hash = await hashEntry(e3);
  const e3Signed = { ...e3, entry_hash: e3Hash, signature: await signEntryHash(e3Hash, keyPair.privateKey) };

  const result = await verifyLedgerChain([e1Signed, e2Signed, e3Signed], keyPair.publicKey);
  expect(result).toEqual({ valid: true, brokenAtIndex: null, reason: null });
});

test("tampering with an entry's content (without re-signing) is detected at the right index", async () => {
  const keyPair = await realKeyPair();
  const e1 = makeEntry({ id: "e1", prev_hash: null });
  const e1Hash = await hashEntry(e1);
  const e1Signed = { ...e1, entry_hash: e1Hash, signature: await signEntryHash(e1Hash, keyPair.privateKey) };

  const e2 = makeEntry({ id: "e2", prev_hash: e1Hash, status: "pass" as const });
  const e2Hash = await hashEntry(e2);
  const e2Signed = { ...e2, entry_hash: e2Hash, signature: await signEntryHash(e2Hash, keyPair.privateKey) };

  // Tamper: someone edits entry 2's status from "pass" to "fail" directly
  // in storage/export, without re-signing (the whole point of signing).
  const tampered = { ...e2Signed, status: "fail" as const };

  const result = await verifyLedgerChain([e1Signed, tampered], keyPair.publicKey);
  expect(result.valid).toBe(false);
  expect(result.brokenAtIndex).toBe(1);
  expect(result.reason).toContain("does not match its own recorded hash");
});

test("breaking the chain link (wrong prev_hash) is detected", async () => {
  const keyPair = await realKeyPair();
  const e1 = makeEntry({ id: "e1", prev_hash: null });
  const e1Hash = await hashEntry(e1);
  const e1Signed = { ...e1, entry_hash: e1Hash, signature: await signEntryHash(e1Hash, keyPair.privateKey) };

  // e2 claims a prev_hash that doesn't match e1's real hash — as if an
  // entry from a different point in history (or a different chain
  // entirely) were spliced in.
  const e2 = makeEntry({ id: "e2", prev_hash: "0000000000000000000000000000000000000000000000000000000000000000" });
  const e2Hash = await hashEntry(e2);
  const e2Signed = { ...e2, entry_hash: e2Hash, signature: await signEntryHash(e2Hash, keyPair.privateKey) };

  const result = await verifyLedgerChain([e1Signed, e2Signed], keyPair.publicKey);
  expect(result.valid).toBe(false);
  expect(result.brokenAtIndex).toBe(1);
  expect(result.reason).toContain("prev_hash");
});

test("a forged entry signed with the WRONG private key is detected even with a correct hash/chain", async () => {
  const realKeys = await realKeyPair();
  const forgerKeys = await realKeyPair();

  const e1 = makeEntry({ id: "e1", prev_hash: null });
  const e1Hash = await hashEntry(e1);
  // Signed with an attacker's key, not the real publicized signing key —
  // hash and chain linkage are both internally consistent, only the
  // signature betrays it.
  const forged = { ...e1, entry_hash: e1Hash, signature: await signEntryHash(e1Hash, forgerKeys.privateKey) };

  const result = await verifyLedgerChain([forged], realKeys.publicKey);
  expect(result.valid).toBe(false);
  expect(result.reason).toContain("signature does not verify");
});
