/**
 * Insurer-grade verification ledger — see PRO_FEATURES_ROADMAP.md item 4.
 * A hash-chained, Ed25519-signed, append-only log of every completed
 * verification (pass or fail), one chain per user. The whole point is
 * that a third party (an insurer, an auditor) can check the export is
 * genuine using ONLY the published public key and basic crypto — nobody
 * has to trust Vestal's word for it, which is what makes this different
 * from just exporting a table of rows.
 *
 * Verified for real (2026-07-24) against Cloudflare Workers' actual
 * crypto.subtle implementation, not assumed from spec docs: Ed25519
 * keygen/sign/verify, 64-byte signatures, 32-byte raw public keys,
 * tamper detection (flipping one byte of signed data correctly fails
 * verification).
 */

export interface LedgerEntryContent {
  id: string;
  user_id: string;
  check_id: string;
  check_name: string;
  backend: string;
  status: "pass" | "fail";
  message: string | null;
  prev_hash: string | null;
  created_at: number;
}

/** Deterministic field order, not object insertion order — JSON.stringify
 * on an object doesn't guarantee key order across engines/versions the
 * way an explicit array does, and hash reproducibility across independent
 * verifiers depends on every verifier hashing the exact same bytes. */
function canonicalizeEntry(entry: LedgerEntryContent): string {
  return JSON.stringify([
    entry.id,
    entry.user_id,
    entry.check_id,
    entry.check_name,
    entry.backend,
    entry.status,
    entry.message,
    entry.prev_hash,
    entry.created_at,
  ]);
}

function bufferToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuffer(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function hashEntry(entry: LedgerEntryContent): Promise<string> {
  const data = new TextEncoder().encode(canonicalizeEntry(entry));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bufferToHex(digest);
}

export async function importSigningPrivateKey(pkcs8Base64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", base64ToBuffer(pkcs8Base64), { name: "Ed25519" }, false, ["sign"]);
}

export async function importSigningPublicKey(rawBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", base64ToBuffer(rawBase64), { name: "Ed25519" }, false, ["verify"]);
}

/** Signs the hex-encoded entry hash — signs the hash's ASCII hex bytes,
 * not the raw digest bytes, so a verifier working from a plain-text
 * export (JSON/CSV) can reproduce the exact signed bytes without needing
 * to know a specific hex-decoding step first. */
export async function signEntryHash(entryHash: string, privateKey: CryptoKey): Promise<string> {
  const signature = await crypto.subtle.sign("Ed25519", privateKey, new TextEncoder().encode(entryHash));
  return bufferToBase64(signature);
}

export async function verifyEntrySignature(
  entryHash: string,
  signatureBase64: string,
  publicKey: CryptoKey,
): Promise<boolean> {
  return crypto.subtle.verify(
    "Ed25519",
    publicKey,
    base64ToBuffer(signatureBase64),
    new TextEncoder().encode(entryHash),
  );
}

export interface VerifyChainResult {
  valid: boolean;
  brokenAtIndex: number | null;
  reason: string | null;
}

/**
 * Independently verifies a full exported chain: recomputes each entry's
 * hash from its own content, confirms it matches the stored hash,
 * confirms it correctly chains from the previous entry's hash, and
 * confirms the Ed25519 signature over that hash. This is deliberately
 * usable by a THIRD PARTY with nothing but the export and the published
 * public key — it takes no dependency on any Vestal-only state.
 */
export async function verifyLedgerChain(
  entries: Array<LedgerEntryContent & { entry_hash: string; signature: string }>,
  publicKey: CryptoKey,
): Promise<VerifyChainResult> {
  let expectedPrevHash: string | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.prev_hash !== expectedPrevHash) {
      return { valid: false, brokenAtIndex: i, reason: "prev_hash does not match the previous entry's hash" };
    }
    const recomputedHash = await hashEntry(entry);
    if (recomputedHash !== entry.entry_hash) {
      return { valid: false, brokenAtIndex: i, reason: "entry content does not match its own recorded hash" };
    }
    const signatureValid = await verifyEntrySignature(entry.entry_hash, entry.signature, publicKey);
    if (!signatureValid) {
      return { valid: false, brokenAtIndex: i, reason: "signature does not verify against the published public key" };
    }
    expectedPrevHash = entry.entry_hash;
  }
  return { valid: true, brokenAtIndex: null, reason: null };
}
