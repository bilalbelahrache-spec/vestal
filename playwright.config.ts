import { defineConfig, devices } from "@playwright/test";

// Defaults to a local `wrangler dev` instance (must already be running —
// kept as an explicit precondition rather than an auto-started webServer,
// since the same dev server doubles as the target for manual curl
// verification in the same session). Override with PLAYWRIGHT_BASE_URL to
// run the exact same suite against the live production deployment
// instead — that's real, not theoretical: this config previously
// hardcoded the local URL with no override, so a "test against
// production" run silently re-tested localhost instead. Caught by
// actually checking what was listening on the port, not by trusting a
// clean test-run summary.
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    // The app has a real, deliberate `prefers-reduced-motion` path for its
    // decorative animations (see app.css's flame-flicker, motion.ts) — but
    // a still-running one (opacity/transform on an inline SVG path in the
    // header logo, shown on every auth-shell screen including the
    // post-signup API key reveal) causes ~1px of sub-pixel layout jitter
    // every frame. That's invisible to a human but fails Playwright's
    // strict actionability check (it requires two consecutive identical
    // bounding-box samples before it'll click), causing exactly the kind
    // of "element is not stable" timeout seen in a real run — confirmed by
    // directly sampling the button's bounding box and `document
    // .getAnimations()` mid-test, not guessed. Reduced motion sidesteps
    // decorative animation entirely for automated runs, the same
    // accessibility path a real user with the OS setting enabled gets.
    reducedMotion: "reduce",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
