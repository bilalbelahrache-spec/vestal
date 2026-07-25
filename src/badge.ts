/**
 * The embeddable "verified X ago" status badge — GROWTH_DISTRIBUTION_PLAN.md's
 * trust-badge item. Deliberately public/unauthenticated (same reasoning as
 * /api/ledger/public-key): the whole point is a real, live, checkable claim
 * someone can drop into their own README or dashboard, not something that
 * needs a Vestal login to render. A stale or wrong badge is a severity-1 bug
 * per that plan, not cosmetic — this always reads the check's current
 * `last_status`/`last_ping_at` live, no caching layer of its own, and every
 * response carries Cache-Control: private, no-store from the global security
 * middleware, so a browser or CDN never serves a stale image.
 */

import type { CheckRow, CheckStatus } from "./types";

const COLORS: Record<CheckStatus, string> = {
  pass: "#2ea44f",
  fail: "#d1242f",
  late: "#bf8700",
  new: "#6e7781",
};

/** Compact, badge-width-friendly relative time — "3h ago", "2d ago", not
 * the fuller phrasing the dashboard's own relativeTime() uses. */
function compactAge(nowSeconds: number, thenSeconds: number): string {
  const diff = Math.max(0, nowSeconds - thenSeconds);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 2592000) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 2592000)}mo ago`;
}

function badgeMessage(check: CheckRow, nowSeconds: number): string {
  if (check.last_status === "new") return "not checked in yet";
  if (check.last_status === "fail") return "failed";
  if (check.last_status === "late") return "overdue";
  return check.last_ping_at ? `verified ${compactAge(nowSeconds, check.last_ping_at)}` : "verified";
}

/** Rough monospace-ish width estimate (~6.5px/char at the font size below,
 * the same approximation shields.io-style badge generators use) — good
 * enough for a badge, not typeset-precision text layout. */
function textWidth(text: string): number {
  return Math.round(text.length * 6.5) + 10;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderBadgeSvg(label: string, message: string, color: string): string {
  const labelWidth = textWidth(label);
  const messageWidth = textWidth(message);
  const totalWidth = labelWidth + messageWidth;
  const height = 20;
  const labelSafe = escapeXml(label);
  const messageSafe = escapeXml(message);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" role="img" aria-label="${labelSafe}: ${messageSafe}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalWidth}" height="${height}" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="${height}" fill="#555"/>
    <rect x="${labelWidth}" width="${messageWidth}" height="${height}" fill="${color}"/>
    <rect width="${totalWidth}" height="${height}" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelWidth / 2}" y="14">${labelSafe}</text>
    <text x="${labelWidth + messageWidth / 2}" y="14">${messageSafe}</text>
  </g>
</svg>`;
}

/** Renders the live badge for a real check. */
export function renderCheckBadge(check: CheckRow, nowSeconds: number): string {
  return renderBadgeSvg("backup", badgeMessage(check, nowSeconds), COLORS[check.last_status]);
}

/** A deleted/unknown check ID still needs to render *something* — a broken
 * image icon in someone's README is worse than an honest neutral badge, and
 * silently 404ing would leave stale copies of a badge (from before a check
 * was deleted) looking like a rendering failure. */
export function renderUnknownBadge(): string {
  return renderBadgeSvg("backup", "unknown check", COLORS.new);
}
