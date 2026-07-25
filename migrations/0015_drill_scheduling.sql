-- Restore-drill scheduling — closes the "Scheduling" gap left open in
-- PRO_FEATURES_ROADMAP.md item 5. The Worker can't actually TRIGGER a
-- drill remotely (agents are pull-based: they ping the Worker, the Worker
-- never reaches out to a user's backup server) — so "scheduling" here
-- means the same thing overdue-check detection already means: the Worker
-- notices a configured cadence has been missed and ALERTS about it, on
-- the same 5-minute cron sweep as findOverdueChecks(). The user still
-- runs the actual drill (VESTAL_DRILL_MODE on their own agent script);
-- this just makes sure they hear about it if it's gone quiet.
--
-- Both nullable: NULL drill_interval_seconds means "no drill schedule
-- configured for this check" — opt-in, same as VESTAL_DRILL_MODE itself,
-- not a new default obligation on every existing check.
ALTER TABLE checks ADD COLUMN drill_interval_seconds INTEGER;
ALTER TABLE checks ADD COLUMN last_drill_reminder_at INTEGER;
