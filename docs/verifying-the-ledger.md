# Verifying a Vestal ledger export independently

Vestal's verification ledger (`GET /api/ledger/export`) is a hash-chained, Ed25519-signed record of
every completed backup verification for an account. The point of signing it is that **you don't have
to trust Vestal's word for it** — an insurer, an auditor, or you yourself can check that an export is
genuine using nothing but the export file and Vestal's published public key (`GET
/api/ledger/public-key`), with standard, widely-implemented cryptography (SHA-256 and Ed25519). This
document explains exactly how, so that check doesn't depend on trusting Vestal's own server to tell you
whether its own signatures are valid.

## What you need

1. The export JSON from `GET /api/ledger/export` (requires the account's own login — export it
   yourself, or have the account holder send it to you).
2. The public key from `GET /api/ledger/public-key` (no login required — this is meant to be public).

## What each entry contains

```json
{
  "id": "...",
  "user_id": "...",
  "check_id": "...",
  "check_name": "nightly-backup",
  "backend": "restic",
  "status": "pass",
  "message": "...",
  "prev_hash": "... or null for the first entry",
  "entry_hash": "sha256 hex digest",
  "signature": "Ed25519 signature, base64",
  "created_at": 1784800000
}
```

## The three things to check, per entry, in order

For each entry, in the order they appear in the export:

**1. The content hash is genuine.** Recompute SHA-256 over this exact JSON array (this exact field
order matters — it's not the entry object's own key order, which isn't guaranteed to be stable):

```
[id, user_id, check_id, check_name, backend, status, message, prev_hash, created_at]
```

JSON-encode that array (standard `JSON.stringify`-equivalent encoding), UTF-8 encode the resulting
string, SHA-256 it, and compare the hex digest to the entry's own `entry_hash`. If they don't match,
either this entry's content was altered after the fact, or the hash itself was forged — either way,
stop, the export is not trustworthy from this entry onward.

**2. The chain link is intact.** This entry's `prev_hash` must equal the *previous* entry's
`entry_hash` (or be `null`, only for the very first entry in the export). If it doesn't match, an
entry has been removed, reordered, or spliced in from elsewhere.

**3. The signature is genuine.** Verify the Ed25519 signature (`entry.signature`, base64-decoded)
against the entry's own `entry_hash` (as its raw ASCII/UTF-8 bytes, not decoded from hex first) using
the published public key. If verification fails, this entry was never actually signed by the key
that's supposed to have produced this export — it's forged, or signed by a different key entirely.

An export is only genuine if **all three checks pass for every entry**, and the checks are chained: if
entry 5 is invalid, don't bother distinguishing whether entries 6+ are individually "valid" — the whole
export is compromised from that point.

## Reference implementation (Node.js, using nothing but built-in Web Crypto)

```js
const { subtle } = globalThis.crypto;

function canonicalize(e) {
  return JSON.stringify([e.id, e.user_id, e.check_id, e.check_name, e.backend, e.status, e.message, e.prev_hash, e.created_at]);
}
function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function b64ToBuf(b64) {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

async function verifyExport(entries, publicKeyBase64) {
  const publicKey = await subtle.importKey(
    "raw", b64ToBuf(publicKeyBase64), { name: "Ed25519" }, false, ["verify"],
  );

  let expectedPrevHash = null;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.prev_hash !== expectedPrevHash) {
      return { valid: false, brokenAt: i, reason: "chain link mismatch" };
    }
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(e)));
    if (toHex(digest) !== e.entry_hash) {
      return { valid: false, brokenAt: i, reason: "content hash mismatch" };
    }
    const sigOk = await subtle.verify(
      "Ed25519", publicKey, b64ToBuf(e.signature), new TextEncoder().encode(e.entry_hash),
    );
    if (!sigOk) {
      return { valid: false, brokenAt: i, reason: "signature does not verify" };
    }
    expectedPrevHash = e.entry_hash;
  }
  return { valid: true, brokenAt: null, reason: null };
}
```

This is real, tested code — it's a from-scratch reimplementation of the same checks Vestal's own
`src/ledger.ts` performs (see `tests/ledger.spec.ts`), written independently to prove the export format
doesn't secretly depend on Vestal's own code to check. It was run against a real exported chain from a
real account and correctly: (1) validated a genuine, untampered export; (2) caught a flipped
pass/fail status on one entry; (3) caught a broken chain link; (4) caught a signature swapped in from
a different entry. All four cases behave exactly as described above.

## What this does and doesn't prove

**It proves**: every entry in the export was genuinely produced (signed) by whoever holds Vestal's
private signing key, in the exact order shown, with content that hasn't been altered since signing.

**It does NOT prove**: that the underlying verification (the actual `restic check`, `borg check`, etc.
that produced a "pass") was itself correct — the ledger attests to what Vestal's agent reported, not
to the ground truth of your backup's integrity independent of Vestal. It also doesn't prove Vestal's
private key itself hasn't been compromised; the same "who holds the key" trust question exists for
any signing scheme, which is why the key is a genuine secret (`wrangler secret put
LEDGER_SIGNING_PRIVATE_KEY`), never committed or logged.
