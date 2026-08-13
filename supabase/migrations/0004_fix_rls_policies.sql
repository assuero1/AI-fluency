-- Corrige as policies da 0003: user_id referencia public.users.id, que difere
-- de auth.users.id. A função mapeia o auth id da sessão para o id público.

create or replace function public.current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.users where auth_user_id = auth.uid()
$$;

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
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select using (user_id = public.current_user_id())', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert with check (user_id = public.current_user_id())', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update using (user_id = public.current_user_id()) with check (user_id = public.current_user_id())', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete using (user_id = public.current_user_id())', t || '_delete_own', t);
  end loop;
end $$;
