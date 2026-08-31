-- Sessão "palavras novas": novos valores em checks existentes + campo de
-- julgamento da IA por tentativa. Idempotente.

alter table public.practice_sessions drop constraint if exists practice_sessions_type_check;
alter table public.practice_sessions add constraint practice_sessions_type_check
  check (type is null or type = any (array['conversation', 'flashcards', 'weak_words', 'calendar_focus', 'recurring_error', 'new_words']));

alter table public.flashcards drop constraint if exists flashcards_card_type_check;
alter table public.flashcards add constraint flashcards_card_type_check
  check (card_type is null or card_type = any (array['target_to_native', 'native_to_target', 'cloze', 'listening', 'translation']));

alter table public.word_senses drop constraint if exists word_senses_source_check;
alter table public.word_senses add constraint word_senses_source_check
  check (source is null or source = any (array['chat', 'manual', 'backfill', 'session']));

alter table public.flashcard_attempts add column if not exists judgment_json jsonb;
