import { test, expect } from "@playwright/test";
import { derivePlanUpdate, isProUser, isTeamUser, verifyPaddleWebhookSignature } from "../src/billing";

// Signature tests below compute a REAL HMAC-SHA256 via the actual Web
// Crypto API (same convention as tests/ledger.spec.ts) — nothing mocked.
// The signed-payload construction (`${ts}:${rawBody}`) and header format
// (`ts=...;h1=...`) match Paddle's own documented algorithm exactly (see
// src/billing.ts's file comment for the source).

async function realSignature(secret: string, ts: number, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${ts}:${rawBody}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SECRET = "pdl_ntfset_test_5f3a9c2e1b8d7f4a6c0e2b9d1a3f5c7e";
const BODY = JSON.stringify({ event_type: "subscription.activated", data: { id: "sub_1", status: "active" } });

test("a genuine, fresh signature verifies", async () => {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = await realSignature(SECRET, ts, BODY);
  const result = await verifyPaddleWebhookSignature(BODY, `ts=${ts};h1=${h1}`, SECRET, ts);
  expect(result).toEqual({ valid: true, reason: null });
});

test("a signature computed with the wrong secret is rejected", async () => {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = await realSignature("wrong-secret", ts, BODY);
  const result = await verifyPaddleWebhookSignature(BODY, `ts=${ts};h1=${h1}`, SECRET, ts);
  expect(result.valid).toBe(false);
  expect(result.reason).toBe("signature does not match");
});

test("a body tampered with after signing is rejected (real bit-for-bit re-check, not just a length check)", async () => {
  const ts = Math.floor(Date.now() / 1000);
  const h1 = await realSignature(SECRET, ts, BODY);
  const tamperedBody = JSON.stringify({ event_type: "subscription.activated", data: { id: "sub_1", status: "canceled" } });
  const result = await verifyPaddleWebhookSignature(tamperedBody, `ts=${ts};h1=${h1}`, SECRET, ts);
  expect(result.valid).toBe(false);
  expect(result.reason).toBe("signature does not match");
});

test("a stale timestamp is rejected as a replay even with a genuinely correct signature", async () => {
  const staleTs = Math.floor(Date.now() / 1000) - 3600; // an hour old
  const h1 = await realSignature(SECRET, staleTs, BODY);
  const result = await verifyPaddleWebhookSignature(BODY, `ts=${staleTs};h1=${h1}`, SECRET);
  expect(result.valid).toBe(false);
  expect(result.reason).toBe("timestamp outside replay-protection tolerance");
});

test("a missing or malformed Paddle-Signature header is rejected", async () => {
  expect((await verifyPaddleWebhookSignature(BODY, undefined, SECRET)).valid).toBe(false);
  expect((await verifyPaddleWebhookSignature(BODY, "not-a-real-header", SECRET)).valid).toBe(false);
  expect((await verifyPaddleWebhookSignature(BODY, "ts=abc;h1=def", SECRET)).valid).toBe(false);
});

test("derivePlanUpdate grants pro for active and trialing subscriptions", () => {
  expect(derivePlanUpdate({ id: "sub_1", status: "active", customer_id: "ctm_1" }).plan).toBe("pro");
  expect(derivePlanUpdate({ id: "sub_1", status: "trialing", customer_id: "ctm_1" }).plan).toBe("pro");
});

test("derivePlanUpdate demotes to free for canceled, paused, and past_due subscriptions", () => {
  expect(derivePlanUpdate({ id: "sub_1", status: "canceled", customer_id: "ctm_1" }).plan).toBe("free");
  expect(derivePlanUpdate({ id: "sub_1", status: "paused", customer_id: "ctm_1" }).plan).toBe("free");
  // A failed payment must NOT keep Pro access indefinitely while Paddle retries.
  expect(derivePlanUpdate({ id: "sub_1", status: "past_due", customer_id: "ctm_1" }).plan).toBe("free");
});

test("derivePlanUpdate carries custom_data.user_id through for first-time linking", () => {
  const update = derivePlanUpdate({
    id: "sub_1",
    status: "active",
    customer_id: "ctm_1",
    custom_data: { user_id: "user-42" },
  });
  expect(update.userId).toBe("user-42");
  expect(update.paddleCustomerId).toBe("ctm_1");
  expect(update.paddleSubscriptionId).toBe("sub_1");
});

test("derivePlanUpdate returns null userId when custom_data is absent (renewal-style event)", () => {
  const update = derivePlanUpdate({ id: "sub_1", status: "active", customer_id: "ctm_1" });
  expect(update.userId).toBeNull();
});

test("isProUser is the single source of truth for plan gating", () => {
  expect(isProUser({ plan: "pro" })).toBe(true);
  expect(isProUser({ plan: "free" })).toBe(false);
  expect(isProUser(null)).toBe(false);
});

test("isProUser treats team as a strict superset of pro", () => {
  expect(isProUser({ plan: "team" })).toBe(true);
});

test("isTeamUser is true only for team, not pro or free", () => {
  expect(isTeamUser({ plan: "team" })).toBe(true);
  expect(isTeamUser({ plan: "pro" })).toBe(false);
  expect(isTeamUser({ plan: "free" })).toBe(false);
  expect(isTeamUser(null)).toBe(false);
});

const TEAM_PRICE_IDS = { monthly: "pri_team_monthly", annual: "pri_team_annual" };

test("derivePlanUpdate grants team when the subscribed price matches a configured team price", () => {
  const monthly = derivePlanUpdate(
    { id: "sub_1", status: "active", customer_id: "ctm_1", price_id: "pri_team_monthly" },
    TEAM_PRICE_IDS,
  );
  expect(monthly.plan).toBe("team");
  const annual = derivePlanUpdate(
    { id: "sub_1", status: "active", customer_id: "ctm_1", price_id: "pri_team_annual" },
    TEAM_PRICE_IDS,
  );
  expect(annual.plan).toBe("team");
});

test("derivePlanUpdate grants only pro when the price doesn't match a team price, even with team ids configured", () => {
  const update = derivePlanUpdate(
    { id: "sub_1", status: "active", customer_id: "ctm_1", price_id: "pri_regular_pro_monthly" },
    TEAM_PRICE_IDS,
  );
  expect(update.plan).toBe("pro");
});

test("derivePlanUpdate never grants team on a canceled subscription, even with a team price id", () => {
  const update = derivePlanUpdate(
    { id: "sub_1", status: "canceled", customer_id: "ctm_1", price_id: "pri_team_monthly" },
    TEAM_PRICE_IDS,
  );
  expect(update.plan).toBe("free");
});
