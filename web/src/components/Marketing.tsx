import type { ComponentChildren } from "preact";
import { Link } from "../router";
import { BrandIcon } from "./BrandIcon";

/* Shared building blocks for the marketing/content pages. Purely
   presentational — every piece of real product UI (dashboard, auth) has
   its own components; these exist so the landing, docs, pricing, etc.
   speak one visual language without copy-pasting markup. */

export function SectionHead({
  eyebrow,
  title,
  lead,
  center,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  center?: boolean;
}) {
  return (
    <div class={`section-head${center ? " is-center" : ""}`}>
      <p class="eyebrow reveal">{eyebrow}</p>
      <h2 class="reveal">{title}</h2>
      {lead && <p class="section-lead reveal">{lead}</p>}
    </div>
  );
}

/** Sub-page hero: consistent opener for pricing/docs/security/etc. */
export function PageHero({
  eyebrow,
  title,
  lead,
  children,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  children?: ComponentChildren;
}) {
  return (
    <header class="page-hero">
      <div class="container">
        <p class="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead && <p class="page-hero-lead">{lead}</p>}
        {children}
      </div>
    </header>
  );
}

export interface TermLine {
  /** Rendered with a leading `$ ` prompt. */
  cmd?: string;
  /** Plain output line. */
  out?: string;
  /** Tone for output lines. */
  tone?: "ok" | "err" | "warn" | "dim";
}

/** A fixed-dark terminal window — reads as a screenshot in both themes. */
export function Terminal({ title, lines }: { title: string; lines: TermLine[] }) {
  return (
    <div class="term" role="img" aria-label={`Terminal: ${title}`}>
      <div class="term-bar">
        <span class="term-dot" />
        <span class="term-dot" />
        <span class="term-dot" />
        <span class="term-title">{title}</span>
      </div>
      <pre class="term-body">
        {lines.map((l) => (
          <div class={`term-line${l.tone ? ` is-${l.tone}` : ""}`}>
            {l.cmd !== undefined ? (
              <>
                <span class="term-prompt">$ </span>
                {l.cmd}
              </>
            ) : (
              l.out
            )}
          </div>
        ))}
      </pre>
    </div>
  );
}

/** Status pill used across marketing mockups (mirrors the real app's). */
export function MockBadge({ kind, children }: { kind: "pass" | "fail" | "late" | "new"; children: ComponentChildren }) {
  return <span class={`status-badge status-${kind}`}>{children}</span>;
}

/** The four backup tools Vestal ships agents for, each with its own real
    project mark (see BrandIcon.tsx for provenance). restic has no official
    flat/vector logo, only a raster mascot, so it renders as an <img>. */
export function ToolMarks() {
  return (
    <div class="tool-marks">
      <span class="tool-mark">
        <img class="tool-mark-img" src="/logos/restic.png" alt="" aria-hidden="true" width={22} height={22} />
        restic
      </span>
      <span class="tool-mark">
        <BrandIcon name="borgbackup" class="tool-mark-glyph" />
        BorgBackup
      </span>
      <span class="tool-mark">
        <BrandIcon name="kopia" class="tool-mark-glyph" />
        Kopia
      </span>
      <span class="tool-mark">
        <BrandIcon name="duplicati" class="tool-mark-glyph" />
        Duplicati
      </span>
    </div>
  );
}

/** The alert channels Vestal fires: Discord and Slack get their real marks,
    email/webhooks are generic concepts (nobody owns those marks). */
export function ChannelMarks() {
  return (
    <div class="tool-marks">
      <span class="tool-mark">
        <BrandIcon name="discord" class="tool-mark-glyph" />
        Discord
      </span>
      <span class="tool-mark">
        <BrandIcon name="slack" class="tool-mark-glyph" />
        Slack
      </span>
      <span class="tool-mark">
        <BrandIcon name="email" class="tool-mark-glyph" />
        Email
      </span>
      <span class="tool-mark">
        <BrandIcon name="webhook" class="tool-mark-glyph" />
        Webhooks
      </span>
    </div>
  );
}

export interface FaqEntry {
  q: string;
  a: ComponentChildren;
}

/** Native <details> accordion — keyboard/screen-reader behavior for free. */
export function FaqList({ entries }: { entries: FaqEntry[] }) {
  return (
    <div class="faq-list reveal-stagger">
      {entries.map((e, i) => (
        <details class="faq-item reveal" style={`--stagger-i: ${i % 6}`}>
          <summary>
            {e.q}
            <svg class="faq-chevron" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </summary>
          <div class="faq-answer">{e.a}</div>
        </details>
      ))}
    </div>
  );
}

/** The closing conversion band shared by every marketing page. */
export function CtaBand({
  title = "Stop hoping your backups work.",
  sub = "Set up your first verified check in about five minutes. No card, no trial clock, no sales call.",
}: {
  title?: string;
  sub?: string;
}) {
  return (
    <section class="cta-band">
      <div class="cta-band-inner container">
        <h2>{title}</h2>
        <p class="cta-band-sub">{sub}</p>
        <div class="cta-band-actions">
          <Link to="/signup" class="btn-primary btn-lg">
            Start monitoring free
          </Link>
          <Link to="/docs" class="btn-ghost-dark btn-lg">
            Read the docs
          </Link>
        </div>
      </div>
    </section>
  );
}
