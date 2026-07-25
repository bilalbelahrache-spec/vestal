import { test, expect } from "@playwright/test";

// Pure API-level tests (Playwright's `request` fixture, no browser page) —
// there's no admin UI flow to click through in a browser sense beyond a
// static page fetching these same endpoints, so this exercises the real
// Worker directly, the same "against the real thing, not mocked" spirit
// as e2e.spec.ts's browser tests.

// Matches .dev.vars' local-only ADMIN_API_KEY exactly — not the real
// production secret, which is set separately via `wrangler secret put`
// and never appears in this repo.
const ADMIN_KEY = process.env.ADMIN_API_KEY ?? "vs_admin_hdL2wT1qeLORwqZzA9WMJ8NHjqejv9kYjOPNinTulTA";

function uniqueEmail(label: string): string {
  return `admin-e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

const PASSWORD = "correcthorsebatterystaple";

test("admin routes reject no auth, wrong key, and malformed header alike", async ({ request }) => {
  const noAuth = await request.get("/api/admin/users");
  expect(noAuth.status()).toBe(401);

  const wrongKey = await request.get("/api/admin/users", {
    headers: { authorization: "Bearer definitely-not-the-key" },
  });
  expect(wrongKey.status()).toBe(401);

  // A valid *user* API key must not work here — this route group is a
  // completely separate authority, not "a privileged user."
  const signupRes = await request.post("/api/auth/signup", {
    data: { email: uniqueEmail("notadmin"), password: PASSWORD, turnstile_token: "test" },
  });
  const { api_key } = await signupRes.json();
  const userKeyTried = await request.get("/api/admin/users", {
    headers: { authorization: `Bearer ${api_key}` },
  });
  expect(userKeyTried.status()).toBe(401);
});

test("admin can list, inspect, and delete a real account end to end", async ({ request }) => {
  const email = uniqueEmail("target");
  const signupRes = await request.post("/api/auth/signup", {
    data: { email, password: PASSWORD, turnstile_token: "test" },
  });
  expect(signupRes.ok()).toBeTruthy();
  const { id } = await signupRes.json();

  const authHeaders = { authorization: `Bearer ${ADMIN_KEY}` };

  const listRes = await request.get("/api/admin/users", { headers: authHeaders });
  expect(listRes.ok()).toBeTruthy();
  const users = await listRes.json();
  expect(users.some((u: { id: string }) => u.id === id)).toBe(true);

  const detailRes = await request.get(`/api/admin/users/${id}`, { headers: authHeaders });
  expect(detailRes.ok()).toBeTruthy();
  const detail = await detailRes.json();
  expect(detail.email).toBe(email);
  expect(detail.checks).toEqual([]);

  const statsRes = await request.get("/api/admin/stats", { headers: authHeaders });
  expect(statsRes.ok()).toBeTruthy();
  const stats = await statsRes.json();
  expect(stats.total_users).toBeGreaterThanOrEqual(1);

  const deleteRes = await request.delete(`/api/admin/users/${id}`, { headers: authHeaders });
  expect(deleteRes.ok()).toBeTruthy();

  // Genuinely gone, not just hidden from the list — same real-deletion bar
  // as the self-service delete-account E2E test.
  const afterDelete = await request.get(`/api/admin/users/${id}`, { headers: authHeaders });
  expect(afterDelete.status()).toBe(404);

  const loginAfterDelete = await request.post("/api/auth/login", {
    data: { email, password: PASSWORD },
  });
  expect(loginAfterDelete.status()).toBe(401);
});

test("deleting a nonexistent account 404s instead of silently succeeding", async ({ request }) => {
  const res = await request.delete("/api/admin/users/not-a-real-id", {
    headers: { authorization: `Bearer ${ADMIN_KEY}` },
  });
  expect(res.status()).toBe(404);
});
