import type { AlertChannelRow, CheckRow, Env } from "./types";
import { sendEmail } from "./email";
import { APP_ORIGIN, type EmailContent, renderEmailHtml, renderEmailText } from "./email-template";

export interface AlertContext {
  check: CheckRow;
  reason: "late" | "failed" | "anomaly" | "drill_failed" | "drill_overdue";
  detail?: string | null;
}

/**
 * Dispatches one alert to one channel. Returns true if it was actually
 * sent, false if the channel kind isn't wired up yet (see STATUS.md) —
 * callers should log false results rather than silently swallow them,
 * so a misconfigured/unimplemented channel is visible in `wrangler tail`
 * instead of just quietly not alerting anyone.
 */
export async function dispatchAlert(
  env: Env,
  channel: AlertChannelRow,
  ctx: AlertContext,
): Promise<boolean> {
  switch (channel.kind) {
    case "discord":
      return sendDiscord(channel.target, ctx);
    case "webhook":
      return sendGenericWebhook(channel.target, ctx);
    case "slack":
      return sendSlack(channel.target, ctx);
    case "email": {
      const heading =
        ctx.reason === "failed"
          ? "A check just reported a failure"
          : ctx.reason === "anomaly"
            ? "Unusual change volume detected"
            : ctx.reason === "drill_failed"
              ? "A restore drill failed"
              : ctx.reason === "drill_overdue"
                ? "A restore drill is overdue"
                : "A check has gone quiet";
      const content: EmailContent = {
        heading,
        paragraphs: [summarize(ctx)],
        cta: { label: "View your checks", url: `${APP_ORIGIN}/dashboard` },
      };
      return sendEmail(
        env,
        channel.target,
        `Vestal alert: ${ctx.check.name}`,
        renderEmailText(content),
        renderEmailHtml(APP_ORIGIN, content),
      );
    }
    default:
      console.warn("unknown alert channel kind", channel.kind);
      return false;
  }
}

function summarize(ctx: AlertContext): string {
  const { check, reason, detail } = ctx;
  if (reason === "late") {
    return `"${check.name}" (${check.backend}) hasn't checked in — expected every ${check.expected_interval_seconds}s, plus ${check.grace_period_seconds}s grace. Your backup may not be getting verified right now.`;
  }
  if (reason === "anomaly") {
    return `"${check.name}" (${check.backend}) triggered the ransomware/anomaly canary.${detail ? " " + detail : ""}`;
  }
  if (reason === "drill_failed") {
    return `"${check.name}" (${check.backend})'s restore drill FAILED — a real restore was attempted and didn't complete cleanly.${detail ? " Detail: " + detail : ""} This is distinct from a normal verification failure: it means an actual recovery attempt didn't work, not just that a metadata check found a problem.`;
  }
  if (reason === "drill_overdue") {
    return `"${check.name}" (${check.backend}) hasn't had a restore drill run in longer than its configured schedule — set VESTAL_DRILL_MODE the next time this check's agent script runs to catch up. Vestal can only remind you; it can't trigger the drill itself since agents are pull-based.`;
  }
  return `"${check.name}" (${check.backend}) reported a FAILED verification.${detail ? " Detail: " + detail : ""}`;
}

async function sendDiscord(
  webhookUrl: string,
  ctx: AlertContext,
): Promise<boolean> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: `**Vestal alert** — ${summarize(ctx)}`,
    }),
  });
  return res.ok;
}

/**
 * Slack's incoming-webhook format is Block Kit, not the plain `{content}`
 * shape Discord accepts — genuinely a different payload, not the generic
 * webhook with a new header. `text` is included alongside `blocks` per
 * Slack's own guidance: it's the fallback shown in notifications/screen
 * readers, which don't render blocks.
 */
async function sendSlack(webhookUrl: string, ctx: AlertContext): Promise<boolean> {
  const { check, reason } = ctx;
  const emoji =
    reason === "failed" || reason === "drill_failed"
      ? ":red_circle:"
      : reason === "anomaly"
        ? ":rotating_light:"
        : ":warning:";
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `Vestal alert — ${summarize(ctx)}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `${emoji} *Vestal alert*\n${summarize(ctx)}` },
        },
        {
          type: "context",
          elements: [
            { type: "mrkdwn", text: `Backend: \`${check.backend}\`  •  Check: \`${check.name}\`` },
          ],
        },
      ],
    }),
  });
  return res.ok;
}

async function sendGenericWebhook(
  url: string,
  ctx: AlertContext,
): Promise<boolean> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      check_id: ctx.check.id,
      check_name: ctx.check.name,
      backend: ctx.check.backend,
      reason: ctx.reason,
      detail: ctx.detail ?? null,
      message: summarize(ctx),
    }),
  });
  return res.ok;
}
