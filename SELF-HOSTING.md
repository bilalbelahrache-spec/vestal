# Self-hosting Vestal

The entire hosted product is one Cloudflare Worker and one D1 database. Running it yourself costs nothing on Cloudflare's free tier for personal or small-team use, and nothing is held back from this path — there is no "self-hosted but crippled" version.

## Prerequisites

- A free [Cloudflare account](https://dash.cloudflare.com/sign-up)
- Node.js 20+
- `npm install -g wrangler` (or use `npx wrangler`)

## Steps

```bash
git clone <this repo>
cd Vestal
npm install

# Log into your own Cloudflare account
npx wrangler login

# Create your own D1 database — this prints a database_id
npx wrangler d1 create vestal
# Paste that database_id into wrangler.jsonc, replacing REPLACE_WITH_REAL_D1_DATABASE_ID

# Apply the schema
npm run db:migrate:remote

# Deploy
npm run deploy
```

Wrangler prints your Worker's URL at the end (something like `vestal.<your-subdomain>.workers.dev`). That's your ping-endpoint base — use it in place of `vestal.dev` everywhere in your own setup.

## Creating your first check

A real dashboard exists now — visit your Worker's URL in a browser, sign up with an email and password, and use the UI to create a check and an alert channel. It'll show you the exact agent command to paste into your cron job, generated for the backend you pick.

If you'd rather script it (or you're wiring up automation), everything the UI does is also a plain JSON API:

```bash
# Sign up with email + password (separate from your API key, so losing the
# key doesn't mean losing the account). This also returns your API key,
# shown exactly once.
curl -X POST https://<your-worker-url>/api/auth/signup \
  -c cookies.txt \
  -H 'content-type: application/json' \
  -d '{"email": "you@example.com", "password": "at-least-8-characters"}'
# => {"id": "...", "email": "...", "api_key": "vs_..."}
# (cookies.txt now holds a session cookie too, if you want to keep scripting
# authenticated requests via -b cookies.txt instead of the Bearer key)

# Create a check (Bearer key works the same as before)
curl -X POST https://<your-worker-url>/api/checks \
  -H "authorization: Bearer vs_YOUR_KEY" \
  -H 'content-type: application/json' \
  -d '{"name": "nas-restic-check", "backend": "restic", "expected_interval_seconds": 86400, "grace_period_seconds": 7200}'
# => includes "ping_url": "https://<your-worker-url>/ping/<token>"

# Add an alert channel (discord, slack, webhook, or email all work)
curl -X POST https://<your-worker-url>/api/alert-channels \
  -H "authorization: Bearer vs_YOUR_KEY" \
  -H 'content-type: application/json' \
  -d '{"kind": "discord", "target": "https://discord.com/api/webhooks/..."}'

# Lost your API key? It's not your only way in anymore — log in with your
# email/password on the dashboard and regenerate one from there.
```

Then point `agent/vestal-restic.sh` (or `agent/vestal-borg.sh`) at that `ping_url` (see the script's header comment for the required environment variables) as a step in your existing backup cron job.
