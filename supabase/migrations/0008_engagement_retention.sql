-- 0008: mecânicas de engajamento (streak persistida, meta diária, conquistas,
-- assinaturas de push). Aditivo e idempotente.

alter table public.users add column if not exists current_streak integer not null default 0;
alter table public.users add column if not exists longest_streak integer not null default 0;
alter table public.users add column if not exists last_practice_day date;
alter table public.users add column if not exists streak_freeze_used_on date;
alter table public.users add column if not exists milestone_seen integer not null default 0;
alter table public.users add column if not exists daily_goal_minutes integer not null default 15;
alter table public.users add column if not exists reminder_hour integer;
alter table public.users add column if not exists last_reminder_sent date;

create table if not exists public.engagement_achievements (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  "Name" text,
  user_id uuid,
  achievement_key text not null,
  payload jsonb,
  unlocked_at timestamptz default now(),
  created_at timestamptz default now()
);
create unique index if not exists engagement_achievements_user_key
  on public.engagement_achievements (user_id, achievement_key);

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  "Name" text,
  user_id uuid,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

alter table public.engagement_achievements enable row level security;
alter table public.push_subscriptions enable row level security;

do $$
begin
  execute format('drop policy if exists %I on public.%I', 'engagement_achievements_select_own', 'engagement_achievements');
  execute format('create policy %I on public.%I for select using (user_id = auth.uid())', 'engagement_achievements_select_own', 'engagement_achievements');
  execute format('drop policy if exists %I on public.%I', 'engagement_achievements_insert_own', 'engagement_achievements');
  execute format('create policy %I on public.%I for insert with check (user_id = auth.uid())', 'engagement_achievements_insert_own', 'engagement_achievements');
  execute format('drop policy if exists %I on public.%I', 'engagement_achievements_update_own', 'engagement_achievements');
  execute format('create policy %I on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', 'engagement_achievements_update_own', 'engagement_achievements');
  execute format('drop policy if exists %I on public.%I', 'engagement_achievements_delete_own', 'engagement_achievements');
  execute format('create policy %I on public.%I for delete using (user_id = auth.uid())', 'engagement_achievements_delete_own', 'engagement_achievements');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_select_own', 'push_subscriptions');
  execute format('create policy %I on public.%I for select using (user_id = auth.uid())', 'push_subscriptions_select_own', 'push_subscriptions');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_insert_own', 'push_subscriptions');
  execute format('create policy %I on public.%I for insert with check (user_id = auth.uid())', 'push_subscriptions_insert_own', 'push_subscriptions');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_update_own', 'push_subscriptions');
  execute format('create policy %I on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', 'push_subscriptions_update_own', 'push_subscriptions');
  execute format('drop policy if exists %I on public.%I', 'push_subscriptions_delete_own', 'push_subscriptions');
  execute format('create policy %I on public.%I for delete using (user_id = auth.uid())', 'push_subscriptions_delete_own', 'push_subscriptions');
end $$;
