// Run after `vite build` (see package.json's `build` script) via vite-node,
// so it gets the exact same JSX/TS transform as the real app instead of a
// hand-rolled Node build step that could silently diverge from it.
//
// Why this exists: web/src/lib/seo.ts already documents the gap: Google's
// indexer does execute JS before indexing, but that's a slower "second
// wave" than a page whose raw HTML already has the right <title> before any
// script runs. This closes that gap for every public marketing/content
// route by rendering each one to a real static HTML file at build time,
// dropped next to the SPA's own dist/index.html. The dashboard and auth
// pages are deliberately NOT prerendered: they're behind login or a
// redirect guard and have no SEO value, and the SPA fallback
// (`not_found_handling: "single-page-application"` in wrangler.jsonc)
// still serves those exactly as before.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderToString } from "preact-render-to-string";
import { h } from "preact";

import { StaticRouterProvider } from "../src/router";
import { ToastProvider } from "../src/context/toast";
import { AuthProvider } from "../src/context/auth";
import { Layout } from "../src/components/Layout";
import { lastSsrMeta, resetSsrMeta, fullPageTitle, type PageMeta } from "../src/lib/seo";

import { Home } from "../src/pages/Home";
import { Pricing } from "../src/pages/Pricing";
import { Docs } from "../src/pages/Docs";
import { Security } from "../src/pages/Security";
import { About } from "../src/pages/About";
import { ForMSPs } from "../src/pages/ForMSPs";
import { Changelog } from "../src/pages/Changelog";
import { Privacy, Refunds, Terms } from "../src/pages/Legal";
import { TestResticRestore } from "../src/pages/articles/TestResticRestore";
import { CompareChecks } from "../src/pages/articles/CompareChecks";
import { ThreeTwoOneRule } from "../src/pages/articles/ThreeTwoOneRule";
import { ExitCodeZero } from "../src/pages/articles/ExitCodeZero";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, "../dist");

const ROUTES: { route: string; Component: () => any }[] = [
  { route: "/", Component: Home },
  { route: "/pricing", Component: Pricing },
  { route: "/docs", Component: Docs },
  { route: "/security", Component: Security },
  { route: "/about", Component: About },
  { route: "/msp", Component: ForMSPs },
  { route: "/changelog", Component: Changelog },
  { route: "/privacy", Component: Privacy },
  { route: "/terms", Component: Terms },
  { route: "/refund", Component: Refunds },
  { route: "/articles/test-restic-backup-restores", Component: TestResticRestore },
  { route: "/articles/compare-check-commands", Component: CompareChecks },
  { route: "/articles/3-2-1-backup-rule-home-nas", Component: ThreeTwoOneRule },
  { route: "/articles/exit-code-0-is-not-enough", Component: ExitCodeZero },
];

function outputPathFor(route: string): string {
  // NOT index.html: Cloudflare's asset serving uses that exact file both
  // for a literal "/" request AND as the not_found_handling fallback shell
  // for every other non-prerendered SPA route (/dashboard, /login, 404s,
  // ...). Overwriting it with Home's prerendered body made every one of
  // those routes flash real homepage content before client JS replaced it
  // with the actual page, confirmed live via `wrangler dev` (curl
  // /login came back with Home's markup already in #app). Written to its
  // own file instead so it exists, ready for a follow-up that teaches the
  // Worker to serve it at "/" specifically (needs a `run_worker_first`
  // entry + an ASSETS binding, deliberately not done in this pass), without
  // regressing every other route in the meantime.
  if (route === "/") return path.join(distDir, "home.html");
  // `.html` (not `/index.html`) to match Cloudflare Workers assets' default
  // `auto-trailing-slash` handling, which serves `<path>.html` at the
  // extensionless `<path>`, the same form every <Link>/<Route> in this app
  // already uses (no trailing slashes anywhere in app.tsx).
  return path.join(distDir, `${route.slice(1)}.html`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function injectHead(template: string, meta: PageMeta, route: string): string {
  const fullTitle = fullPageTitle(meta.title);
  const canonicalUrl = `https://vestalapp.com${route === "/" ? "/" : route}`;
  const title = escapeHtml(fullTitle);
  const description = escapeHtml(meta.description);

  let html = template;
  html = html.replace(/<title>.*?<\/title>/s, `<title>${title}</title>`);
  html = html.replace(
    /<meta\s+name="description"\s+content=".*?"\s*\/>/s,
    `<meta name="description" content="${description}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:title"\s+content=".*?"\s*\/>/,
    `<meta property="og:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:description"\s+content=".*?"\s*\/>/s,
    `<meta property="og:description" content="${description}" />`,
  );
  html = html.replace(
    /<meta\s+property="og:url"\s+content=".*?"\s*\/>/,
    `<meta property="og:url" content="${canonicalUrl}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:title"\s+content=".*?"\s*\/>/,
    `<meta name="twitter:title" content="${title}" />`,
  );
  html = html.replace(
    /<meta\s+name="twitter:description"\s+content=".*?"\s*\/>/s,
    `<meta name="twitter:description" content="${description}" />`,
  );
  // Insert a canonical <link> right before </head>: index.html doesn't
  // ship one at all (only the client-side setCanonical() in seo.ts adds it,
  // which is exactly the second-wave-only gap this script exists to close).
  html = html.replace("</head>", `    <link rel="canonical" href="${canonicalUrl}" />\n  </head>`);
  return html;
}

function main() {
  const template = fs.readFileSync(path.join(distDir, "index.html"), "utf-8");
  const results: { route: string; ok: boolean; detail: string }[] = [];

  for (const { route, Component } of ROUTES) {
    // Reset before each render: usePageMeta only writes this when
    // `document` is undefined (true for this whole script), so a page that
    // somehow skipped calling it would otherwise silently inherit the
    // previous route's title instead of failing loudly.
    resetSsrMeta();
    let meta: PageMeta | null = null;
    let bodyHtml: string;
    try {
      const app = h(
        StaticRouterProvider,
        { path: route },
        h(ToastProvider, null, h(AuthProvider, null, h(Layout, { bleed: true }, h(Component, null)))),
      );
      bodyHtml = renderToString(app);
      meta = lastSsrMeta;
    } catch (err) {
      results.push({ route, ok: false, detail: `render threw: ${(err as Error).message}` });
      continue;
    }

    if (!meta) {
      results.push({ route, ok: false, detail: "usePageMeta never ran: no per-route <title>/<meta> to inject" });
      continue;
    }

    let page = template.replace('<div id="app"></div>', `<div id="app">${bodyHtml}</div>`);
    page = injectHead(page, meta, route);

    const outPath = outputPathFor(route);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, page);
    results.push({ route, ok: true, detail: path.relative(distDir, outPath) });
  }

  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    console.log(`${r.ok ? "OK  " : "FAIL"} ${r.route.padEnd(45)} ${r.detail}`);
  }
  if (failed.length > 0) {
    console.error(`\nprerender: ${failed.length}/${results.length} routes failed`);
    process.exit(1);
  }
  console.log(`\nprerender: ${results.length}/${results.length} routes OK`);
}

main();
