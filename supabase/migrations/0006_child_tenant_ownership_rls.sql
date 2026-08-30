-- Isolamento entre tenants nas tabelas-folha + planos de RLS mais baratos.
--
-- 0004 deixou todas as policies como user_id = current_user_id(). Isso abria
-- uma brecha de injeção cross-tenant: autenticado via PostgREST pode INSERT
-- numa tabela-folha com o PRÓPRIO user_id e o conversation_id/practice_session_id/
-- word_id de OUTRO usuário — a linha passa no RLS e aparece no app da vítima.
-- As policies de insert/update das folhas passam a exigir também que o pai
-- pertença ao mesmo usuário.
--
-- Além disso, todas as policies passam a avaliar current_user_id() dentro de
-- um scalar subquery (select public.current_user_id()): o Postgres vira o
-- initplan de uma execução por statement em vez de por linha.

do $$
declare
  t text;
begin
  -- Tabelas sem pai interno (raiz da cadeia de posse): mesmas regras da 0004,
  -- só com o id de usuário hoisted.
  foreach t in array array[
    'language_profiles', 'ai_provider_settings', 'voice_provider_settings',
    'conversations', 'words', 'daily_feedbacks', 'topics',
    'practice_sessions', 'app_events'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select using (user_id = (select public.current_user_id()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert with check (user_id = (select public.current_user_id()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update using (user_id = (select public.current_user_id())) with check (user_id = (select public.current_user_id()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete using (user_id = (select public.current_user_id()))', t || '_delete_own', t);
  end loop;

  -- Tabelas-folha: select/delete seguem por user_id (ler/apagar linha que já
  -- é sua é seguro); insert/update ganham a checagem de posse do pai.
  foreach t in array array[
    'messages', 'corrections', 'word_senses', 'word_occurrences',
    'word_usage_summaries', 'flashcards', 'flashcard_attempts'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for select using (user_id = (select public.current_user_id()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for delete using (user_id = (select public.current_user_id()))', t || '_delete_own', t);
  end loop;
end $$;

-- messages → conversations (a mensagem só entra em conversa própria)
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages for insert
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select public.current_user_id())
    )
  );

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages for update
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and c.user_id = (select public.current_user_id())
    )
  );

-- corrections → conversations (+ messages quando preenchido)
drop policy if exists corrections_insert_own on public.corrections;
create policy corrections_insert_own on public.corrections for insert
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.conversations c
      where c.id = corrections.conversation_id
        and c.user_id = (select public.current_user_id())
    )
    and (corrections.message_id is null or exists (
      select 1 from public.messages m
      where m.id = corrections.message_id
        and m.user_id = (select public.current_user_id())
    ))
  );

drop policy if exists corrections_update_own on public.corrections;
create policy corrections_update_own on public.corrections for update
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.conversations c
      where c.id = corrections.conversation_id
        and c.user_id = (select public.current_user_id())
    )
    and (corrections.message_id is null or exists (
      select 1 from public.messages m
      where m.id = corrections.message_id
        and m.user_id = (select public.current_user_id())
    ))
  );

-- word_senses → words
drop policy if exists word_senses_insert_own on public.word_senses;
create policy word_senses_insert_own on public.word_senses for insert
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.words w
      where w.id = word_senses.word_id
        and w.user_id = (select public.current_user_id())
    )
  );

drop policy if exists word_senses_update_own on public.word_senses;
create policy word_senses_update_own on public.word_senses for update
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.words w
      where w.id = word_senses.word_id
        and w.user_id = (select public.current_user_id())
    )
  );

-- word_occurrences → words (+ conversations/messages quando preenchidos)
drop policy if exists word_occurrences_insert_own on public.word_occurrences;
create policy word_occurrences_insert_own on public.word_occurrences for insert
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.words w
      where w.id = word_occurrences.word_id
        and w.user_id = (select public.current_user_id())
    )
    and (word_occurrences.conversation_id is null or exists (
      select 1 from public.conversations c
      where c.id = word_occurrences.conversation_id
        and c.user_id = (select public.current_user_id())
    ))
    and (word_occurrences.message_id is null or exists (
      select 1 from public.messages m
      where m.id = word_occurrences.message_id
        and m.user_id = (select public.current_user_id())
    ))
  );

drop policy if exists word_occurrences_update_own on public.word_occurrences;
create policy word_occurrences_update_own on public.word_occurrences for update
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.words w
      where w.id = word_occurrences.word_id
        and w.user_id = (select public.current_user_id())
    )
    and (word_occurrences.conversation_id is null or exists (
      select 1 from public.conversations c
      where c.id = word_occurrences.conversation_id
        and c.user_id = (select public.current_user_id())
    ))
    and (word_occurrences.message_id is null or exists (
      select 1 from public.messages m
      where m.id = word_occurrences.message_id
        and m.user_id = (select public.current_user_id())
    ))
  );

-- word_usage_summaries → words (+ conversations quando preenchido)
drop policy if exists word_usage_summaries_insert_own on public.word_usage_summaries;
create policy word_usage_summaries_insert_own on public.word_usage_summaries for insert
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.words w
      where w.id = word_usage_summaries.word_id
        and w.user_id = (select public.current_user_id())
    )
    and (word_usage_summaries.conversation_id is null or exists (
      select 1 from public.conversations c
      where c.id = word_usage_summaries.conversation_id
        and c.user_id = (select public.current_user_id())
    ))
  );

drop policy if exists word_usage_summaries_update_own on public.word_usage_summaries;
create policy word_usage_summaries_update_own on public.word_usage_summaries for update
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.words w
      where w.id = word_usage_summaries.word_id
        and w.user_id = (select public.current_user_id())
    )
    and (word_usage_summaries.conversation_id is null or exists (
      select 1 from public.conversations c
      where c.id = word_usage_summaries.conversation_id
        and c.user_id = (select public.current_user_id())
    ))
  );

-- flashcards → practice_sessions (+ words via target_word_id quando preenchido)
drop policy if exists flashcards_insert_own on public.flashcards;
create policy flashcards_insert_own on public.flashcards for insert
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.practice_sessions ps
      where ps.id = flashcards.practice_session_id
        and ps.user_id = (select public.current_user_id())
    )
    and (flashcards.target_word_id is null or exists (
      select 1 from public.words w
      where w.id = flashcards.target_word_id
        and w.user_id = (select public.current_user_id())
    ))
  );

drop policy if exists flashcards_update_own on public.flashcards;
create policy flashcards_update_own on public.flashcards for update
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.practice_sessions ps
      where ps.id = flashcards.practice_session_id
        and ps.user_id = (select public.current_user_id())
    )
    and (flashcards.target_word_id is null or exists (
      select 1 from public.words w
      where w.id = flashcards.target_word_id
        and w.user_id = (select public.current_user_id())
    ))
  );

-- flashcard_attempts → practice_sessions (+ flashcards quando preenchido)
drop policy if exists flashcard_attempts_insert_own on public.flashcard_attempts;
create policy flashcard_attempts_insert_own on public.flashcard_attempts for insert
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.practice_sessions ps
      where ps.id = flashcard_attempts.practice_session_id
        and ps.user_id = (select public.current_user_id())
    )
    and (flashcard_attempts.flashcard_id is null or exists (
      select 1 from public.flashcards f
      where f.id = flashcard_attempts.flashcard_id
        and f.user_id = (select public.current_user_id())
    ))
  );

drop policy if exists flashcard_attempts_update_own on public.flashcard_attempts;
create policy flashcard_attempts_update_own on public.flashcard_attempts for update
  using (user_id = (select public.current_user_id()))
  with check (
    user_id = (select public.current_user_id())
    and exists (
      select 1 from public.practice_sessions ps
      where ps.id = flashcard_attempts.practice_session_id
        and ps.user_id = (select public.current_user_id())
    )
    and (flashcard_attempts.flashcard_id is null or exists (
      select 1 from public.flashcards f
      where f.id = flashcard_attempts.flashcard_id
        and f.user_id = (select public.current_user_id())
    ))
  );
