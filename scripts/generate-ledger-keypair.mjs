// One-time setup: generates the Ed25519 keypair the verification ledger
// signs every entry with (see src/ledger.ts, PRO_FEATURES_ROADMAP.md item
// 4). Run this ONCE per environment (local dev, staging, production —
// each should have its OWN keypair, never share one across environments),
// then:
//
//   - store the private key as a real Cloudflare secret:
//       npx wrangler secret put LEDGER_SIGNING_PRIVATE_KEY
//     (paste the PKCS8 base64 value when prompted)
//
//   - the public key is NOT a secret — it's meant to be published, since
//     that's what lets a third party (an insurer, an auditor) verify an
//     export without trusting Vestal's word for it. Set it as a plain
//     wrangler.jsonc var (LEDGER_SIGNING_PUBLIC_KEY) and document it
//     wherever the ledger export feature is explained.
//
//   - for local dev, add both to .dev.vars (gitignored) instead.
//
// Run with: node scripts/generate-ledger-keypair.mjs
const { subtle } = globalThis.crypto;

const keyPair = await subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
const pkcs8 = await subtle.exportKey("pkcs8", keyPair.privateKey);
const raw = await subtle.exportKey("raw", keyPair.publicKey);

const toB64 = (buf) => Buffer.from(buf).toString("base64");

console.log("LEDGER_SIGNING_PRIVATE_KEY (secret — never commit this):");
console.log(toB64(pkcs8));
console.log("");
console.log("LEDGER_SIGNING_PUBLIC_KEY (safe to publish/commit):");
console.log(toB64(raw));
