-- AI Fluency — initial Supabase schema (migrated from Teable)
-- Idempotent: safe to re-run. All FKs use ON DELETE SET NULL to preserve
-- Teable semantics (relations were plain text; deletes were never blocked).

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  name text,
  avatar_url text,
  active_language_id uuid,
  timezone text,
  daily_new_cards_quota integer,
  created_at timestamptz default now()
);

create table if not exists language_profiles (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_code text,
  language_name text,
  level text check (level is null or level = any (array['Iniciante', 'Intermediário (B1)', 'Avançado'])),
  learning_goal text,
  correction_style text check (correction_style is null or correction_style = any (array['Corrigir sempre', 'Corrigir no final', 'Só quando eu pedir'])),
  audio_enabled boolean,
  transcript_enabled boolean,
  calendar_memory_enabled boolean,
  weekly_conversation_goal integer,
  weekly_word_goal integer,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists ai_provider_settings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  provider text check (provider is null or provider = any (array['openai', 'anthropic', 'google', 'openrouter', 'custom', 'kokoro', 'deepseek'])),
  base_url text,
  api_key_masked text,
  chat_model text,
  reasoning_model text,
  temperature numeric,
  max_tokens integer,
  is_active boolean,
  last_test_status text check (last_test_status is null or last_test_status = any (array['not_tested', 'success', 'error'])),
  last_test_at timestamptz
);

create table if not exists voice_provider_settings (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  provider text,
  base_url text,
  api_key_masked text,
  default_voice text,
  speech_speed numeric,
  output_format text check (output_format is null or output_format = any (array['mp3', 'wav', 'opus'])),
  is_active boolean,
  last_test_status text check (last_test_status is null or last_test_status = any (array['not_tested', 'success', 'error'])),
  last_test_at timestamptz
);

create table if not exists topics (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  title text,
  source text check (source is null or source = any (array['user_custom', 'ai_suggestion', 'calendar_based', 'weak_words', 'recurring_error'])),
  reason text,
  related_feedback_id uuid,
  related_words text,
  difficulty text check (difficulty is null or difficulty = any (array['A1', 'A2', 'B1', 'B2', 'C1', 'C2'])),
  created_at timestamptz default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  topic_id uuid,
  mode text check (mode is null or mode = any (array['free_conversation', 'suggested_topic', 'custom_topic', 'review_words', 'calendar_focus'])),
  interaction_mode text check (interaction_mode is null or interaction_mode = any (array['conversation', 'simulation'])),
  target_user_message_count integer,
  status text check (status is null or status = any (array['preparing', 'active', 'completed', 'abandoned', 'failed', 'paused', 'error'])),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  ai_model_used text,
  summary text
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  conversation_id uuid,
  role text check (role is null or role = any (array['user', 'assistant', 'system'])),
  text text,
  audio_url text,
  transcript_text text,
  language_detected text,
  tokens_used integer,
  client_request_id text,
  channel text check (channel is null or channel = any (array['practice', 'teacher'])),
  created_at timestamptz default now()
);

create table if not exists corrections (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  conversation_id uuid,
  message_id uuid,
  original_text text,
  corrected_text text,
  error_type text check (error_type is null or error_type = any (array['grammar', 'vocabulary', 'pronunciation', 'tense', 'preposition', 'word_order', 'naturalness', 'spelling'])),
  explanation text,
  severity text check (severity is null or severity = any (array['low', 'medium', 'high'])),
  should_interrupt boolean,
  created_at timestamptz default now()
);

create table if not exists words (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  lemma text,
  canonical_key text unique,
  display_text text,
  forms_json jsonb,
  translation text,
  part_of_speech text,
  familiarity_score numeric,
  total_uses integer,
  last_used_at timestamptz,
  first_used_at timestamptz,
  review_due_at timestamptz,
  review_interval_days numeric,
  review_ease numeric,
  review_streak integer,
  lapse_count integer,
  last_reviewed_at timestamptz,
  last_rating text check (last_rating is null or last_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  average_response_time_ms numeric,
  review_state text check (review_state is null or review_state = any (array['new', 'learning', 'review', 'difficult', 'suspended'])),
  review_version text,
  learning_step integer,
  implicit_review_at timestamptz,
  leech_flagged_at timestamptz
);

create table if not exists word_senses (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  word_id uuid,
  sense_key text unique,
  translation text,
  part_of_speech text,
  example_sentence text,
  source text check (source is null or source = any (array['chat', 'manual', 'backfill'])),
  is_primary boolean,
  sense_order integer,
  total_uses integer,
  review_due_at timestamptz,
  review_interval_days numeric,
  review_ease numeric,
  review_streak integer,
  lapse_count integer,
  learning_step integer,
  last_reviewed_at timestamptz,
  last_rating text check (last_rating is null or last_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  average_response_time_ms numeric,
  review_state text check (review_state is null or review_state = any (array['new', 'learning', 'review', 'difficult', 'suspended'])),
  review_version text,
  leech_flagged_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists word_occurrences (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  word_id uuid,
  occurrence_key text unique,
  conversation_id uuid,
  message_id uuid,
  used_text text,
  sentence_context text,
  was_correct boolean,
  created_at timestamptz default now()
);

create table if not exists word_usage_summaries (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  usage_key text unique,
  word_id uuid,
  conversation_id uuid,
  forms_json jsonb,
  observed_count integer,
  correct_use_count integer,
  correction_count integer,
  first_used_at timestamptz,
  last_used_at timestamptz
);

create table if not exists daily_feedbacks (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  date timestamptz,
  strengths text,
  weaknesses text,
  recommended_focus text,
  recurring_errors jsonb,
  new_words_count integer,
  correction_score numeric,
  fluency_score numeric,
  suggested_topics jsonb,
  created_at timestamptz default now()
);

create table if not exists practice_sessions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  language_profile_id uuid,
  conversation_id uuid,
  type text check (type is null or type = any (array['conversation', 'flashcards', 'weak_words', 'calendar_focus', 'recurring_error'])),
  focus text,
  status text check (status is null or status = any (array['preparing', 'active', 'completed', 'abandoned', 'failed', 'paused', 'error'])),
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  criterion text,
  requested_word_count integer,
  selected_word_count integer,
  unique_card_count integer,
  presentation_count integer,
  correct_count integer,
  incorrect_count integer,
  score numeric,
  language_code text,
  configuration_json jsonb,
  parent_session_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz
);

create table if not exists flashcards (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  practice_session_id uuid,
  target_word_id uuid,
  target_sense_id uuid,
  supporting_word_ids jsonb,
  card_type text check (card_type is null or card_type = any (array['target_to_native', 'native_to_target', 'cloze', 'listening'])),
  prompt text,
  expected_answer text,
  accepted_answers jsonb,
  translation text,
  explanation text,
  sentence text,
  audio_text text,
  difficulty numeric,
  initial_position integer,
  generation_source text check (generation_source is null or generation_source = any (array['ai', 'deterministic', 'fallback'])),
  created_at timestamptz default now()
);

create table if not exists flashcard_attempts (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  practice_session_id uuid,
  flashcard_id uuid,
  word_id uuid,
  sense_id uuid,
  presentation_number integer,
  client_attempt_id text,
  user_answer text,
  normalized_answer text,
  match_result text check (match_result is null or match_result = any (array['exact', 'acceptable', 'minor_error', 'incorrect', 'unknown'])),
  suggested_rating text check (suggested_rating is null or suggested_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  final_rating text check (final_rating is null or final_rating = any (array['forgot', 'hard', 'good', 'easy'])),
  was_correct boolean,
  response_time_ms numeric,
  used_speech boolean,
  audio_replay_count integer,
  used_slow_audio boolean,
  answered_after_audio_replay boolean,
  audio_failed boolean,
  review_applied boolean,
  resulting_review_state text,
  review_snapshot jsonb,
  undone_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists app_events (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  user_id uuid,
  event_name text not null,
  payload jsonb,
  created_at timestamptz default now()
);

-- Foreign keys (idempotent; ON DELETE SET NULL preserves Teable semantics)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_active_language_id_fkey') then
    alter table users add constraint users_active_language_id_fkey foreign key (active_language_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'language_profiles_user_id_fkey') then
    alter table language_profiles add constraint language_profiles_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ai_provider_settings_user_id_fkey') then
    alter table ai_provider_settings add constraint ai_provider_settings_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'voice_provider_settings_user_id_fkey') then
    alter table voice_provider_settings add constraint voice_provider_settings_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'topics_user_id_fkey') then
    alter table topics add constraint topics_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'topics_language_profile_id_fkey') then
    alter table topics add constraint topics_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'topics_related_feedback_id_fkey') then
    alter table topics add constraint topics_related_feedback_id_fkey foreign key (related_feedback_id) references daily_feedbacks (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_user_id_fkey') then
    alter table conversations add constraint conversations_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_language_profile_id_fkey') then
    alter table conversations add constraint conversations_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'conversations_topic_id_fkey') then
    alter table conversations add constraint conversations_topic_id_fkey foreign key (topic_id) references topics (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'messages_conversation_id_fkey') then
    alter table messages add constraint messages_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'corrections_conversation_id_fkey') then
    alter table corrections add constraint corrections_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'corrections_message_id_fkey') then
    alter table corrections add constraint corrections_message_id_fkey foreign key (message_id) references messages (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_user_id_fkey') then
    alter table words add constraint words_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'words_language_profile_id_fkey') then
    alter table words add constraint words_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_senses_word_id_fkey') then
    alter table word_senses add constraint word_senses_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_occurrences_word_id_fkey') then
    alter table word_occurrences add constraint word_occurrences_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_occurrences_conversation_id_fkey') then
    alter table word_occurrences add constraint word_occurrences_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_occurrences_message_id_fkey') then
    alter table word_occurrences add constraint word_occurrences_message_id_fkey foreign key (message_id) references messages (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_usage_summaries_word_id_fkey') then
    alter table word_usage_summaries add constraint word_usage_summaries_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'word_usage_summaries_conversation_id_fkey') then
    alter table word_usage_summaries add constraint word_usage_summaries_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_feedbacks_user_id_fkey') then
    alter table daily_feedbacks add constraint daily_feedbacks_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'daily_feedbacks_language_profile_id_fkey') then
    alter table daily_feedbacks add constraint daily_feedbacks_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_user_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_language_profile_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_language_profile_id_fkey foreign key (language_profile_id) references language_profiles (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_conversation_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_conversation_id_fkey foreign key (conversation_id) references conversations (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'practice_sessions_parent_session_id_fkey') then
    alter table practice_sessions add constraint practice_sessions_parent_session_id_fkey foreign key (parent_session_id) references practice_sessions (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_practice_session_id_fkey') then
    alter table flashcards add constraint flashcards_practice_session_id_fkey foreign key (practice_session_id) references practice_sessions (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_target_word_id_fkey') then
    alter table flashcards add constraint flashcards_target_word_id_fkey foreign key (target_word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcards_target_sense_id_fkey') then
    alter table flashcards add constraint flashcards_target_sense_id_fkey foreign key (target_sense_id) references word_senses (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_practice_session_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_practice_session_id_fkey foreign key (practice_session_id) references practice_sessions (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_flashcard_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_flashcard_id_fkey foreign key (flashcard_id) references flashcards (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_word_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_word_id_fkey foreign key (word_id) references words (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'flashcard_attempts_sense_id_fkey') then
    alter table flashcard_attempts add constraint flashcard_attempts_sense_id_fkey foreign key (sense_id) references word_senses (id) on delete set null;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'app_events_user_id_fkey') then
    alter table app_events add constraint app_events_user_id_fkey foreign key (user_id) references users (id) on delete set null;
  end if;
end $$;

-- Indexes on hot FK columns
create index if not exists messages_conversation_id_idx on messages (conversation_id);
create index if not exists words_user_id_idx on words (user_id);
create index if not exists words_language_profile_id_idx on words (language_profile_id);
create index if not exists flashcards_practice_session_id_idx on flashcards (practice_session_id);
create index if not exists flashcard_attempts_practice_session_id_idx on flashcard_attempts (practice_session_id);
create index if not exists app_events_user_id_idx on app_events (user_id);
create index if not exists conversations_user_id_idx on conversations (user_id);
create index if not exists daily_feedbacks_user_id_idx on daily_feedbacks (user_id);
