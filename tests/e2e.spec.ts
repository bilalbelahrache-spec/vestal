import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";

// Real end-to-end verification: a headless Chromium instance actually
// clicking through the app against the real Worker + local D1 (via
// `wrangler dev`), not a mocked API. Each test uses a unique email so
// runs don't collide with leftover data from prior runs or manual
// curl testing against the same dev instance.
function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

/**
 * A from-scratch TOTP (RFC 6238) implementation, deliberately independent
 * of src/util.ts's — computing a code the same way the app computes it
 * would only prove the two agree with each other, not that either is
 * actually RFC-correct. This is a real cross-check, run once by hand
 * against the live dev server before this test existed (see the manual
 * verification pass) and now automated here.
 */
function totpCode(secretBase32: string, atSeconds = Math.floor(Date.now() / 1000)): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = secretBase32.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  const secret = Buffer.from(bytes);

  const counter = Math.floor(atSeconds / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

const PASSWORD = "correcthorsebatterystaple";

/** Signs up a fresh account through the real UI and acknowledges the
 * one-time API key screen, landing on the dashboard. Returns the key
 * shown, since several tests need it. */
async function signUp(page: Page, email: string): Promise<string> {
  await page.goto("/signup");
  await page.fill("#signup-email", email);
  await page.fill("#signup-password", PASSWORD);
  await page.fill("#signup-confirm-password", PASSWORD);
  await page.check("#signup-agree");
  await page.click('button[type="submit"]');

  await expect(page.getByText("This is the only time this key will ever be shown")).toBeVisible();
  const key = (await page.locator(".key-box code").textContent())!.trim();
  await page.click('text="I\'ve saved it, continue"');
  await expect(page).toHaveURL(/\/dashboard$/);
  return key;
}

test("signup shows the API key exactly once, then lands on the dashboard", async ({ page }) => {
  const email = uniqueEmail("signup");
  const key = await signUp(page, email);
  expect(key).toMatch(/^vs_[A-Za-z0-9_-]+$/);
  // Scoped to the header specifically — the same email also sits, always
  // mounted (just closed), in SitePanel's off-canvas <dialog> for the
  // mobile nav drawer, so a bare getByText(email) is a strict-mode
  // violation (2 matches) rather than a real ambiguity a visitor would
  // ever see.
  await expect(page.locator(".nav-email")).toContainText(email);
});

test("protected route redirects to login when logged out, then back after login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  const email = uniqueEmail("redirect");
  await signUp(page, email);

  await page.click('button:has-text("Log out")');
  await expect(page).toHaveURL(/\/login$/);

  // Dashboard should redirect again now that we're logged out.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);

  // Fresh login with the same credentials should work and reach the dashboard.
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("wrong password is rejected with a clear error, not a silent failure", async ({ page }) => {
  const email = uniqueEmail("wrongpw");
  await signUp(page, email);
  await page.click('button:has-text("Log out")');

  await page.goto("/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", "definitely-the-wrong-password");
  await page.click('button[type="submit"]');

  await expect(page.locator(".toast-error")).toContainText("Invalid email or password");
  await expect(page).toHaveURL(/\/login$/);
});

test("full check lifecycle: create, see it listed with the right details, delete it", async ({ page }) => {
  const email = uniqueEmail("checks");
  await signUp(page, email);

  await expect(page.getByText("No checks yet")).toBeVisible();

  // Create a check via the real form (backend defaults to restic, interval
  // defaults to 1 day — leave both, just fill in the name).
  await page.fill('input[placeholder="e.g. nas-nightly-backup"]', "e2e-nightly-backup");
  await page.click('button:has-text("Create check")');

  // The create form's own result panel, including the generated agent snippet.
  await expect(page.getByText('"e2e-nightly-backup" is set up')).toBeVisible();
  await expect(page.locator(".code-block")).toContainText("vestal-restic.sh");
  await expect(page.locator(".code-block")).toContainText("VESTAL_PING_URL=");

  // The check now shows up in the list above, with correct status.
  const card = page.locator(".check-card", { hasText: "e2e-nightly-backup" });
  await expect(card).toBeVisible();
  await expect(card.locator(".status-badge")).toHaveText("Not checked in yet");
  await expect(card.locator(".backend-tag")).toHaveText("restic");

  // Delete it, through the real confirm dialog (not a bypassed shortcut).
  // The dialog itself lives in the same DOM subtree as the card (a native
  // <dialog>, not portaled), and also has its own "Delete" button — scope
  // by class, not just text, to avoid matching both.
  await card.locator("button.btn-danger-outline").click();
  await expect(page.locator(".confirm-dialog[open]")).toBeVisible();
  await page.locator('.confirm-dialog[open] button:has-text("Delete")').click();

  await expect(page.getByText("No checks yet")).toBeVisible();
});

test("alert channel: SSRF-blocked target is rejected in the UI, valid one is accepted and removable", async ({
  page,
}) => {
  const email = uniqueEmail("channels");
  await signUp(page, email);

  // Reject: same SSRF protection proven at the API layer, now exercised
  // through the real UI form.
  await page.fill(".add-channel-form input", "http://169.254.169.254/");
  await page.click('.add-channel-form button:has-text("Add channel")');
  await expect(page.locator(".toast-error")).toContainText("https://");

  // Accept: a legitimate target.
  await page.fill(".add-channel-form input", "https://discord.com/api/webhooks/example");
  await page.click('.add-channel-form button:has-text("Add channel")');
  await expect(page.locator(".channel-list")).toContainText("https://discord.com/api/webhooks/example");

  // Remove it.
  await page.click('.channel-list button:has-text("Remove")');
  await page.locator('.confirm-dialog[open] button:has-text("Remove")').click();
  await expect(page.getByText("No alert channels yet")).toBeVisible();
});

test("API key regeneration shows a new key and the old one stops working", async ({ page, request }) => {
  const email = uniqueEmail("apikey");
  const originalKey = await signUp(page, email);

  // Confirm the original key works against the real API before regenerating.
  const before = await request.get("/api/checks", {
    headers: { authorization: `Bearer ${originalKey}` },
  });
  expect(before.ok()).toBe(true);

  await page.click('button:has-text("Regenerate API key")');
  await page.locator('.confirm-dialog[open] button:has-text("Regenerate")').click();
  await expect(page.getByText("New API key generated")).toBeVisible();
  const newKey = (await page.locator(".key-box code").textContent())!.trim();
  expect(newKey).not.toBe(originalKey);

  // The old key must now be rejected — not just "a new key was shown."
  const after = await request.get("/api/checks", {
    headers: { authorization: `Bearer ${originalKey}` },
  });
  expect(after.status()).toBe(401);

  const withNewKey = await request.get("/api/checks", {
    headers: { authorization: `Bearer ${newKey}` },
  });
  expect(withNewKey.ok()).toBe(true);
});

test("forgot password: shows the same confirmation whether or not the account exists", async ({
  page,
}) => {
  // Real link-following (does it land you back at a working login with a
  // changed password) can't be automated here — it needs an actual inbox,
  // same limitation already noted for Discord alerts in STATUS.md. What's
  // testable through the real UI: the non-enumeration guarantee itself,
  // and that a real account genuinely gets a token queued up server-side.
  const email = uniqueEmail("forgot");
  await signUp(page, email);
  await page.click('button:has-text("Log out")');

  await page.goto("/login");
  await page.click('a:has-text("Forgot password?")');
  await expect(page).toHaveURL(/\/forgot-password$/);

  // A registered email...
  await page.fill("#forgot-email", email);
  await page.click('button:has-text("Send reset link")');
  await expect(page.getByText("Check your inbox")).toBeVisible();

  // ...and one that was never signed up both produce the identical
  // confirmation screen — the backend must not leak which is which.
  await page.goto("/forgot-password");
  await page.fill("#forgot-email", uniqueEmail("never-signed-up"));
  await page.click('button:has-text("Send reset link")');
  await expect(page.getByText("Check your inbox")).toBeVisible();
});

test("reset password: rejects a missing or invalid token instead of silently failing", async ({
  page,
}) => {
  await page.goto("/reset-password");
  await expect(page.getByText("Invalid reset link")).toBeVisible();

  await page.goto("/reset-password?token=not-a-real-token");
  await page.fill("#reset-password", "somethingLongEnough123");
  await page.fill("#reset-confirm-password", "somethingLongEnough123");
  await page.click('button:has-text("Update password")');
  await expect(page.locator(".toast-error")).toContainText("invalid or has expired");
});

test("account deletion requires the correct password, then genuinely removes the account", async ({
  page,
}) => {
  const email = uniqueEmail("delete");
  await signUp(page, email);

  await page.click('button:has-text("Delete account")');
  await expect(page.locator(".confirm-dialog[open]")).toBeVisible();

  // Wrong password: rejected, dialog stays open, account still exists.
  await page.fill('.confirm-dialog[open] input[type="password"]', "definitely-the-wrong-password");
  await page.click('.confirm-dialog[open] button:has-text("Delete account")');
  await expect(page.locator(".toast-error")).toContainText("Incorrect password");
  await expect(page.locator(".confirm-dialog[open]")).toBeVisible();

  // Correct password: account is deleted, confirmed with a success toast,
  // and the existing "logged-out on a protected route" guard (already
  // proven by the redirect test above) carries us to /login — this
  // component deliberately doesn't navigate itself, see DangerZone.tsx.
  await page.fill('.confirm-dialog[open] input[type="password"]', PASSWORD);
  await page.click('.confirm-dialog[open] button:has-text("Delete account")');
  await expect(page.locator(".toast-success")).toContainText("Your account has been deleted");
  await expect(page).toHaveURL(/\/login$/);

  // The account genuinely no longer exists — logging in with the same
  // credentials that worked a moment ago must now fail.
  await page.goto("/login");
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator(".toast-error")).toContainText("Invalid email or password");
});

test("full two-factor lifecycle: enable, log in with a code, recover with a backup code, disable", async ({
  page,
}) => {
  const email = uniqueEmail("totp");
  await signUp(page, email);

  await page.click('button:has-text("Enable two-factor authentication")');
  await expect(page.locator(".totp-qr")).toBeVisible();
  const secret = (await page.locator(".totp-setup code").first().textContent())!.trim();
  expect(secret.length).toBeGreaterThan(10);

  await page.fill("#totp-confirm-code", totpCode(secret));
  await page.click('button:has-text("Confirm and enable")');

  await expect(page.locator(".recovery-codes-box")).toBeVisible();
  const recoveryCode = (await page.locator(".recovery-codes-box code").first().textContent())!.trim();
  await page.click('button:has-text("I\'ve saved these, continue")');
  await expect(page.locator(".toast-success")).toContainText("Two-factor authentication is on");
  await expect(page.locator('button:has-text("Disable two-factor authentication")')).toBeVisible();

  // Log out, log back in: password alone should no longer be enough.
  await page.click('button:has-text("Log out")');
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page.locator("#login-totp-code")).toBeVisible();
  await expect(page).not.toHaveURL(/\/dashboard$/);

  await page.fill("#login-totp-code", totpCode(secret));
  await page.click('button:has-text("Verify")');
  await expect(page).toHaveURL(/\/dashboard$/);

  // Log out again and log back in with a recovery code instead, proving
  // the backup path independently works and consumes the code.
  await page.click('button:has-text("Log out")');
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('button[type="submit"]');
  await page.click('button:has-text("Use a recovery code instead")');
  await page.fill("#login-totp-code", recoveryCode);
  await page.click('button:has-text("Verify")');
  await expect(page).toHaveURL(/\/dashboard$/);

  // Disabling requires the password, same as account deletion.
  await page.click('button:has-text("Disable two-factor authentication")');
  await page.fill('.confirm-dialog[open] input[type="password"]', PASSWORD);
  await page.click('.confirm-dialog[open] button:has-text("Disable")');
  // .last(): the "...is on" toast from enabling earlier may not have
  // auto-dismissed yet, so more than one .toast-success can be on screen
  // at once — this asserts on the newest one, not "some toast exists."
  await expect(page.locator(".toast-success").last()).toContainText("Two-factor authentication is off");

  // Confirmed off: a fresh login no longer asks for a code at all.
  await page.click('button:has-text("Log out")');
  await page.fill("#login-email", email);
  await page.fill("#login-password", PASSWORD);
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("new accounts start unverified and the dashboard offers a working resend", async ({ page }) => {
  const email = uniqueEmail("verify");
  await signUp(page, email);

  await expect(page.locator(".verify-banner")).toContainText("Verify your email address");
  await page.click('.verify-banner button:has-text("Resend verification email")');
  await expect(page.locator(".toast-success")).toContainText("Verification email sent");
  await expect(page.locator(".verify-banner button")).toContainText("Sent");
});

test("an invalid email verification link shows a clear error, not a crash", async ({ page }) => {
  await page.goto("/verify-email?token=not-a-real-token");
  await expect(page.getByText("Verification failed")).toBeVisible();
});
