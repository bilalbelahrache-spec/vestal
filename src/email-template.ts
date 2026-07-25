/**
 * Shared transactional-email shell: a hosted banner image (email clients
 * can't embed local assets, so this points at the real deployed site —
 * `${origin}/email-banner.png`, built from the same brand mark as the web
 * UI), a bulletproof table-based CTA button (plain `<a>` padding renders
 * inconsistently in Outlook's Word rendering engine; a table cell with a
 * background color does not), and a plain-text fallback link under the
 * button for clients that strip the button styling entirely. Every email
 * sent by the product should go through this, not a bare `sendEmail(...,
 * text)` call — a raw link with no visual identity is exactly what a
 * phishing email looks like, which was the whole complaint this exists to
 * fix.
 */

export interface EmailContent {
  heading: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  footerNote?: string;
}

/** The stable production origin for contexts with no inbound request to
 * derive one from (the scheduled-alert cron has no `Request`, unlike the
 * auth email senders in index.ts, which use the real request's origin). */
export const APP_ORIGIN = "https://vestalapp.com";

export function renderEmailText(content: EmailContent): string {
  const parts = [content.heading, "", ...content.paragraphs];
  if (content.cta) parts.push("", `${content.cta.label}: ${content.cta.url}`);
  if (content.footerNote) parts.push("", content.footerNote);
  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderEmailHtml(origin: string, content: EmailContent): string {
  const bannerUrl = `${origin}/email-banner.png`;
  const paragraphsHtml = content.paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#3f3c39;">${escapeHtml(p)}</p>`,
    )
    .join("\n");

  const ctaHtml = content.cta
    ? `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;">
      <tr>
        <td style="border-radius:2px;background-color:#312d2a;">
          <a href="${content.cta.url}" style="display:inline-block;padding:12px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:2px;">${escapeHtml(content.cta.label)}</a>
        </td>
      </tr>
    </table>
    <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#8a827a;">Or paste this link into your browser:<br><a href="${content.cta.url}" style="color:#c74634;word-break:break-all;">${content.cta.url}</a></p>`
    : "";

  const footerNoteHtml = content.footerNote
    ? `<p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#8a827a;">${escapeHtml(content.footerNote)}</p>`
    : "";

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Vestal</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f0eb;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f0eb;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background-color:#ffffff;border-radius:4px;overflow:hidden;border:1px solid #e2ded6;">
            <tr>
              <td>
                <img src="${bannerUrl}" width="600" alt="Vestal" style="display:block;width:100%;height:auto;">
              </td>
            </tr>
            <tr>
              <td style="padding:32px 36px 8px;">
                <h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:22px;color:#161513;">${escapeHtml(content.heading)}</h1>
                ${paragraphsHtml}
                ${ctaHtml}
                ${footerNoteHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:20px 36px 28px;border-top:1px solid #e2ded6;">
                <p style="margin:0;font-size:12px;color:#756e66;">Vestal — independent backup restore verification.<br>
                  <a href="${origin}" style="color:#756e66;">${origin.replace(/^https?:\/\//, "")}</a>
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
