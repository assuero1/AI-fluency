-- Multiusuário: vínculo users↔auth.users, user_id denormalizado nas folhas, RLS.

-- 1. users ↔ auth.users
alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete cascade;

-- 2. user_id denormalizado nas tabelas-folha
alter table public.messages add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.corrections add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.word_senses add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.word_occurrences add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.word_usage_summaries add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.flashcards add column if not exists user_id uuid references public.users(id) on delete cascade;
alter table public.flashcard_attempts add column if not exists user_id uuid references public.users(id) on delete cascade;

-- 3. Backfill via tabela-pai
update public.messages m set user_id = c.user_id from public.conversations c where m.conversation_id = c.id and m.user_id is null;
update public.corrections x set user_id = c.user_id from public.conversations c where x.conversation_id = c.id and x.user_id is null;
update public.word_senses s set user_id = w.user_id from public.words w where s.word_id = w.id and s.user_id is null;
update public.word_occurrences o set user_id = w.user_id from public.words w where o.word_id = w.id and o.user_id is null;
update public.word_usage_summaries u set user_id = w.user_id from public.words w where u.word_id = w.id and u.user_id is null;
update public.flashcards f set user_id = p.user_id from public.practice_sessions p where f.practice_session_id = p.id and f.user_id is null;
update public.flashcard_attempts a set user_id = p.user_id from public.practice_sessions p where a.practice_session_id = p.id and a.user_id is null;

-- 4. Órfãos (pai removido por ON DELETE SET NULL ficam sem dono): descartar e travar NOT NULL
delete from public.messages where user_id is null;
delete from public.corrections where user_id is null;
delete from public.word_senses where user_id is null;
delete from public.word_occurrences where user_id is null;
delete from public.word_usage_summaries where user_id is null;
delete from public.flashcards where user_id is null;
delete from public.flashcard_attempts where user_id is null;

alter table public.messages alter column user_id set not null;
alter table public.corrections alter column user_id set not null;
alter table public.word_senses alter column user_id set not null;
alter table public.word_occurrences alter column user_id set not null;
alter table public.word_usage_summaries alter column user_id set not null;
alter table public.flashcards alter column user_id set not null;
alter table public.flashcard_attempts alter column user_id set not null;

create index if not exists messages_user_id_idx on public.messages(user_id);
create index if not exists corrections_user_id_idx on public.corrections(user_id);
create index if not exists word_senses_user_id_idx on public.word_senses(user_id);
create index if not exists word_occurrences_user_id_idx on public.word_occurrences(user_id);
create index if not exists word_usage_summaries_user_id_idx on public.word_usage_summaries(user_id);
create index if not exists flashcards_user_id_idx on public.flashcards(user_id);
create index if not exists flashcard_attempts_user_id_idx on public.flashcard_attempts(user_id);

-- 5. Trigger: todo signup em auth.users ganha registro em public.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (auth_user_id, "Name", timezone, created_at)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''), 'America/Sao_Paulo', now());
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 6. RLS: users por auth_user_id; demais 16 tabelas por user_id
alter table public.users enable row level security;
create policy users_select_own on public.users for select using (auth_user_id = auth.uid());
create policy users_update_own on public.users for update using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'language_profiles', 'ai_provider_settings', 'voice_provider_settings',
    'conversations', 'messages', 'corrections', 'words', 'word_senses',
    'word_occurrences', 'word_usage_summaries', 'daily_feedbacks', 'topics',
    'practice_sessions', 'flashcards', 'flashcard_attempts', 'app_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (user_id = auth.uid())', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert with check (user_id = auth.uid())', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update using (user_id = auth.uid()) with check (user_id = auth.uid())', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete using (user_id = auth.uid())', t || '_delete_own', t);
  end loop;
end $$;
