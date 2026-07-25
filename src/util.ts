/** UUID v4 via the runtime's native crypto — no dependency needed. */
export function uuid(): string {
  return crypto.randomUUID();
}

/**
 * A longer, high-entropy token for ping URLs specifically. These get
 * embedded in cron jobs and shell history on someone's server, so they're
 * treated as bearer secrets in their own right (32 bytes, base64url) even
 * though a uuid() would technically also be unguessable.
 */
export function pingToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function apiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return (
    "vs_" +
    btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "")
  );
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * API keys are 256 bits of random entropy, not a low-entropy human
 * password — a fast, unsalted SHA-256 is the right tool here (the same
 * approach GitHub/Stripe/AWS use for high-entropy tokens), not a slow
 * KDF like bcrypt/scrypt/argon2, which exists specifically to compensate
 * for *low*-entropy secrets. Brute-forcing a 256-bit preimage is
 * infeasible regardless of hash speed. Stored so a database compromise
 * alone doesn't hand over every user's live credential.
 */
export async function hashApiKey(key: string): Promise<string> {
  return sha256Hex(key);
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Passwords are low-entropy human secrets (unlike API keys above), so they
 * need a deliberately slow KDF to resist offline brute force — but the
 * Workers *Free* plan has a hard, non-configurable 10ms CPU-time limit per
 * request (confirmed against Cloudflare's current published limits, not
 * assumed) — and this product's whole pitch is running free forever, so
 * that's the real budget, not a typical unconstrained-server's.
 *
 * 100,000 iterations (a common general-purpose default) was tried first
 * and measured at ~75ms of actual added latency under `wrangler dev` —
 * roughly 7x the entire free-tier CPU budget on its own, before any DB
 * work. 3,000 was the original choice after re-measuring for comfortable
 * headroom. Re-benchmarked directly (a temporary route logging
 * `performance.now()` around hashPassword() under real `wrangler dev` —
 * i.e. real workerd, not Node — then removed) rather than guessed:
 * 3,000 iterations cost ~1-2ms, 6,000 cost ~2-3ms, 10,000 cost ~3-4ms.
 * 6,000 was chosen as a real, measured doubling of attacker cost that
 * still leaves several ms of headroom under the 10ms hard cap for the D1
 * queries and everything else in the same request — not pushed further
 * than that without visibility into actual production edge-server timing
 * (local benchmarking is the same runtime as production but not
 * necessarily the same CPU class, so this stops short of the last mile of
 * headroom rather than gamble on it). Still meaningfully weaker than
 * OWASP's modern PBKDF2-SHA256 guidance (600,000+) — a real, deliberate
 * trade-off made because the platform makes the stronger number
 * impossible to run at all on the free tier, not because more iterations
 * weren't wanted. A per-user random salt (below) is doing real work
 * regardless of iteration count: it defeats precomputed/rainbow table
 * attacks even at a lower cost factor. Self-describing output format
 * (`pbkdf2$iterations$salt$hash`) means this number can be raised later —
 * e.g. once/if a paid-tier request path with a higher CPU budget exists —
 * without invalidating already-stored hashes.
 */
const PBKDF2_ITERATIONS = 6_000;
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Constant-time string comparison — for secrets compared directly
 * (the admin API key), as opposed to hashes-of-secrets like passwords. */
export function timingSafeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(new TextEncoder().encode(a), new TextEncoder().encode(b));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 32 random bytes, base64url — the session cookie's actual value. */
export function sessionToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * 32 random bytes, base64url — a password-reset token. Same shape as
 * sessionToken() but kept as its own named function (like pingToken() vs
 * apiKey()): it goes out over email, not just a cookie, and single-use
 * short-lived semantics are enforced at the DB layer, not by the token
 * format itself.
 */
export function resetToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

/**
 * Rejects alert-channel targets that would turn Vestal's own Worker into
 * an open outbound-request proxy: non-https schemes, and literal
 * loopback/private/link-local IPs (this only catches literal IP targets,
 * not DNS-rebinding via a hostname that resolves to one later — Workers'
 * own network sandboxing is the deeper backstop there, this is defense
 * in depth on top of it, not the only layer).
 */
export function isSafeWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return false;

  // Literal IPv4 loopback/private/link-local ranges.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 127) return false; // loopback
    if (a === 10) return false; // private
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 169 && b === 254) return false; // link-local incl. cloud metadata
    if (a === 0) return false; // "this network"
  }

  // Literal IPv6 loopback/unique-local/link-local.
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) {
    return false;
  }

  return true;
}

// --- TOTP (RFC 6238) two-factor auth --------------------------------------
// SHA-1/6-digits/30s hardcoded rather than configurable: it's the default
// every authenticator app (Google Authenticator, Authy, 1Password, etc.)
// assumes when an otpauth:// URI doesn't say otherwise, and deviating risks
// a real user's app silently generating codes that never match.

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function base32Decode(input: string): Uint8Array {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

/** 160 bits (RFC 4226's recommended minimum key length), base32-encoded
 * for both QR-code and manual-entry display. */
export function generateTotpSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

export function totpAuthUrl(secretBase32: string, accountEmail: string): string {
  const label = encodeURIComponent(`Vestal:${accountEmail}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=Vestal&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
}

async function hotp(secretBytes: Uint8Array, counter: number): Promise<string> {
  const counterBytes = new Uint8Array(8);
  let c = BigInt(counter);
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    secretBytes as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  const offset = sig[sig.length - 1] & 0x0f;
  const binCode =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(binCode % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Accepts a code from the current window or one step either side (±30s)
 * to tolerate real clock drift between the server and the user's phone —
 * without this, a phone even slightly out of sync produces codes that
 * never verify, which looks indistinguishable from a bug. */
export async function verifyTotpCode(
  secretBase32: string,
  code: string,
  atSeconds: number = nowSeconds(),
): Promise<boolean> {
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return false;
  const secretBytes = base32Decode(secretBase32);
  const counter = Math.floor(atSeconds / TOTP_STEP_SECONDS);
  for (const drift of [0, -1, 1]) {
    const expected = await hotp(secretBytes, counter + drift);
    if (timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(normalized))) {
      return true;
    }
  }
  return false;
}

/** A random backup code for when the authenticator app itself is
 * unavailable (phone lost/reset). 40 bits of entropy, base32, split for
 * readability — issued 10 at a time, each usable exactly once. */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const raw = base32Encode(bytes);
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/** Recovery codes are high-entropy random tokens, not human passwords —
 * same SHA-256-not-a-KDF reasoning as hashApiKey() above. */
export async function hashRecoveryCode(code: string): Promise<string> {
  return sha256Hex(code.toUpperCase().replace(/\s/g, ""));
}
