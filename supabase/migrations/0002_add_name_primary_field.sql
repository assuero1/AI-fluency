-- AI Fluency — preserve Teable primary field `Name` in every table.
-- The app actively reads/writes `Name` (record titles) via the Teable-compatible
-- client, so it must exist as a real column everywhere. On `users` it replaces
-- the provisional lowercase `name` column. Idempotent: safe to re-run.

alter table users add column if not exists "Name" text;
alter table language_profiles add column if not exists "Name" text;
alter table ai_provider_settings add column if not exists "Name" text;
alter table voice_provider_settings add column if not exists "Name" text;
alter table conversations add column if not exists "Name" text;
alter table messages add column if not exists "Name" text;
alter table corrections add column if not exists "Name" text;
alter table words add column if not exists "Name" text;
alter table word_senses add column if not exists "Name" text;
alter table word_occurrences add column if not exists "Name" text;
alter table word_usage_summaries add column if not exists "Name" text;
alter table daily_feedbacks add column if not exists "Name" text;
alter table topics add column if not exists "Name" text;
alter table practice_sessions add column if not exists "Name" text;
alter table flashcards add column if not exists "Name" text;
alter table flashcard_attempts add column if not exists "Name" text;
alter table app_events add column if not exists "Name" text;

alter table users drop column if exists name;
