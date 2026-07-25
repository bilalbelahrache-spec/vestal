# Vestal

**Your backup software will tell you it succeeded. Vestal tells you whether you could actually get your data back.**

Backup *creation* is a solved problem — restic, Borg, Duplicati, and Kopia are mature, free, and reliable at writing backups. Backup *restorability* is not solved: a 2026 disaster-recovery industry survey found 82% of setups have automated restore testing set to "never," and there are entire forum threads of people discovering — the hard way, mid-emergency — that a backup which reported "success" for months could not actually be restored.

Vestal is a dead-man's-switch for your backup jobs, in the spirit of [Healthchecks.io](https://healthchecks.io) — except instead of "did my cron job run," it answers "did my backup job run *and prove it can restore.*"

## How it works

1. You run the Vestal agent as a step in your existing backup routine (a cron job, a systemd timer, whatever you already use).
2. The agent runs a real integrity check against your repository (`restic check`, `borg check`, etc.) and, on a slower schedule, performs an actual sample restore + checksum comparison — not just "the backup program exited 0."
3. The agent pings a unique URL for that check, with a pass/fail result.
4. Vestal watches for pings. If a check doesn't ping on schedule, or pings with a failure, you get alerted — email, Discord, Slack, or a generic webhook — immediately, not the day you actually need the restore.

## Why this is free to self-host, forever

The whole engine here — ping ingestion, missed-check detection, alerting — is a single small Cloudflare Worker plus a D1 database. Cloudflare's free tier comfortably covers personal and small-team use. Deploy it to your own Cloudflare account and it costs you nothing, forever, with no feature gate on the self-hosted path. See [`SELF-HOSTING.md`](./SELF-HOSTING.md).

The **hosted version** at [vestalapp.com](https://vestalapp.com) exists for people who'd rather not run their own Cloudflare account: same engine, we host it. It's free to use right now, with optional paid Pro/Team tiers (billed through Paddle) for higher limits and MSP features. The free self-hosted path is never crippled to push you toward the hosted one either way, and the free hosted tier itself is not time-limited or feature-gated to force an upgrade: see `LICENSE`.

## License

AGPL-3.0-or-later. See [`LICENSE`](./LICENSE) for the full legal text.

**Why AGPL and not MIT/BSD:** the self-hosted community Vestal targets (r/selfhosted, r/homelab)
explicitly values software staying free and open. AGPL specifically closes the one gap a permissive
license (MIT/BSD) leaves open: a well-funded competitor could take this exact code, run a closed,
improved fork as a competing hosted SaaS, and out-market the original with no obligation to
contribute anything back. AGPL's network-use clause means anyone who runs a modified version as a
network service has to make their source available too, which protects the project's only real
structural advantage (being first, in the open, in a space no single company is motivated to own)
without limiting anyone's right to self-host it for free, which was never in question.
