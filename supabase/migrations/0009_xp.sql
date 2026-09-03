-- 0009: XP como moeda única de progresso (Plano 3). Aditivo e idempotente.
alter table public.users add column if not exists xp_total integer not null default 0;
alter table public.users add column if not exists quest_xp_keys jsonb not null default '[]'::jsonb;
