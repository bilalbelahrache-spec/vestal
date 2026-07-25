import type { Env } from "./types";
import { nowSeconds } from "./util";

export interface RateLimitResult {
  allowed: boolean;
  /** Only meaningful when `allowed` is false — how long until the current
   * window resets, for a `Retry-After` header. */
  retryAfterSeconds: number;
}

/**
 * Fixed-window rate limit: at most `max` calls to `checkRateLimit` with the
 * same `bucketKey` inside any `windowSeconds`-long window. Deliberately a
 * fixed window (not sliding) — it can let up to 2x `max` through right at
 * a window boundary, which is an accepted, documented trade-off for "stop
 * obvious brute-force/spam" rather than a precision rate limiter.
 *
 * One D1 round trip per call via `INSERT ... ON CONFLICT DO UPDATE`, so
 * the increment is atomic even under concurrent requests hitting the same
 * bucket — two requests racing can't both read count=4 and both proceed
 * past a limit of 5.
 */
export async function checkRateLimit(
  env: Env,
  bucketKey: string,
  max: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const now = nowSeconds();
  const windowStart = now - (now % windowSeconds);

  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (bucket_key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT (bucket_key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`,
  )
    .bind(bucketKey, windowStart)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return {
    allowed: count <= max,
    retryAfterSeconds: windowStart + windowSeconds - now,
  };
}

/** The IP Cloudflare's edge actually terminated the connection from — set
 * by Cloudflare itself on every request, not client-suppliable, so it
 * can't be spoofed the way a client-sent header (X-Forwarded-For) could. */
export function clientIp(req: Request): string {
  return req.headers.get("CF-Connecting-IP") ?? "unknown";
}

/** Deletes rate-limit windows old enough that nothing will ever query them
 * again — called from the cron handler so the table doesn't grow forever. */
export async function pruneRateLimits(env: Env, olderThanSeconds: number): Promise<void> {
  await env.DB.prepare("DELETE FROM rate_limits WHERE window_start < ?")
    .bind(nowSeconds() - olderThanSeconds)
    .run();
}
