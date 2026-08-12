# Migração Teable → Supabase — Design

**Data:** 2026-08-12
**Status:** Aprovado pelo usuário (escopo, abordagem A, cutover por env var)
**Objetivo:** Substituir o Teable (self-hosted) pelo Supabase (novo projeto, conta nova) como banco de dados do AI Fluency, com **paridade 100% de dados e comportamento** — nada no app pode quebrar. Melhorias de integridade (FKs, UNIQUE, jsonb) são bem-vindas desde que transparentes para o app.

## Contexto

- App Next.js single-user (na prática), `AI_FLUENCY_USER_ID` identifica o usuário pessoal.
- 17 tabelas no Teable, definidas em `lib/teable/schema.ts` + campos adicionados por `scripts/ensure-*.mjs`.
- Volume pequeno: ~1.700 registros totais (maior tabela: AppEvents com 571).
- Todo acesso a dados passa por `lib/teable/client.ts` (`TeableClient`, fetch REST puro). Consumidores: `lib/learning/*`, `lib/ai/model-settings.ts`, `lib/settings/status.ts`, e algumas API routes (`events`, `language-profiles`, `health/teable`, `settings/test-teable`, `teable/schema`, `settings/ai/model`).
- Limitações atuais do Teable que NÃO serão carregadas como dependência, mas cujo comportamento será preservado:
  - Filtros server-side inconfiáveis → app faz client-side filtering (preservado no adapter).
  - Relations são texto (`recXxx`) → viram FKs reais + `legacy_id`.
  - Campos `json` são strings → viram `jsonb` com parse na migração, mas o adapter continua **retornando string** no shape `fields` para não quebrar consumidores (ver "Adapter").
- Backups JSON existentes em `backups/` cobrem parcialmente; será feito backup integral novo antes da migração.

## Decisões tomadas com o usuário

1. **Escopo:** migração completa — schema + dados + troca do backend do app + QA harness.
2. **Acesso:** `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` no `.env.local` (já fornecidos). Acesso 100% server-side; anon key não é usada.
3. **Teable após migração:** código `lib/teable/*` e scripts permanecem arquivados e funcionais (rollback), sem uso por default.
4. **QA harness:** migra junto (fixtures passam a ser criados no Supabase).
5. **Abordagem:** adapter drop-in (Abordagem A) — mesma interface do `TeableClient` sobre Supabase.
6. **Dados:** 100% do que há no Teable migra, **incluindo AppEvents** (telemetria).

## Arquitetura

### Nova dependência

- `@supabase/supabase-js` (única dependência nova).

### Env vars

- `SUPABASE_URL` — URL do projeto.
- `SUPABASE_SERVICE_ROLE_KEY` — secret, server-only (já no `.env.local`; adicionar ao `.env.example` como placeholder e ao Vercel no deploy).
- `DATA_BACKEND` — `supabase` (default) | `teable` (rollback). Ausente = `supabase`.

### `lib/supabase/config.ts`

- `getSupabaseConfig()`: lê e valida as env vars (reuso do padrão de `lib/env.ts` para filtrar placeholders), lança erro de config análogo a `TeableConfigError`.
- `getSupabaseStatus()`: para telas de diagnóstico (equivalente a `getTeableStatus`).

### `lib/supabase/client.ts` — adapter drop-in

Interface compatível com `TeableClient`:

- `healthcheck()`, `listRecords(table, take)`, `listAllRecords(table)`, `listRecordsWhere`, `listRecordsWhereAll`, `getRecord(table, id)`, `createRecord`, `updateRecord`, `deleteRecord`, `safeUpdateRecord`, `createEvent`.
- **Shape de retorno preservado:** `{ id, fields: { ... } }` — consumidores em `lib/learning/*` não mudam (apenas o import, via factory).
- Conversões transparentes no adapter:
  - Leitura: colunas `jsonb` → string JSON em `fields.*` (paridade com o formato string do Teable que o app já faz parse).
  - Escrita: strings JSON em campos json → parse antes do insert/update; se o parse falhar, erro explícito (nunca grava string inválida em jsonb).
  - IDs: o adapter expõe o **uuid** como `id`. Relations escritas pelo app após o cutover já carregam uuids (lidam-se a si mesmas). Filtros por relation usam o uuid diretamente.
  - `listRecordsWhere`: traduz o filtro para PostgREST quando trivial (eq em coluna), com **fallback client-side** igual ao atual — comportamento idêntico ao de hoje.
- Timeout de 10s e 1 retry em GETs (paridade com `TeableClient`).
- Erros mapeados para tipos análogos (`SupabaseConfigError`/`SupabaseRequestError`) e tratados em `lib/api/responses.ts` junto aos existentes.

### Ponto de troca (factory)

- `lib/teable/index.ts` (ou módulo equivalente que hoje exporta o client) vira factory: lê `DATA_BACKEND` e exporta a instância ativa. Nenhum outro arquivo precisa saber qual backend está ativo.
- Rotas de diagnóstico (`health/teable`, `settings/test-teable`, `teable/schema`) ganham equivalentes Supabase (`health/db`, `settings/test-db`) ou passam a reportar o backend ativo via factory — decisão final no plano de implementação, mantendo as rotas antigas funcionando enquanto `DATA_BACKEND=teable`.

## Schema Postgres

Arquivo versionado: `supabase/migrations/0001_initial_schema.sql` (aplicado via SQL Editor do dashboard ou script com service role).

Convenções:

- Tabelas em snake_case plural (`users`, `language_profiles`, ...), 17 tabelas.
- `id uuid primary key default gen_random_uuid()`.
- `legacy_id text unique` — guarda o `recXxx` do Teable (auditoria/depuração; não é usado pelo app após o cutover).
- FKs reais (`references`) para todas as relations abaixo.
- `timestamptz` para datas; `boolean` para checkboxes; `numeric`/`integer` para numbers; `text` para text/longText/url/singleSelect.
- `jsonb` para: `words.forms_json`, `word_usage_summaries.forms_json`, `daily_feedbacks.recurring_errors`, `daily_feedbacks.suggested_topics`, `flashcards.supporting_word_ids`, `flashcards.accepted_answers`, `practice_sessions.configuration_json`, `flashcard_attempts.review_snapshot`, `app_events.payload`.
- UNIQUE: `words.canonical_key`, `word_senses.sense_key`, `word_occurrences.occurrence_key`, `word_usage_summaries.usage_key`.
- CHECK constraints nos selects (choices de `scripts/setup-teable-schema.mjs`): `language_profiles.level` (Iniciante/Intermediário (B1)/Avançado), `correction_style`, `ai_provider_settings.provider` (openai/anthropic/google/openrouter/custom/kokoro/deepseek), `last_test_status` (not_tested/success/error), `voice_provider_settings.output_format` (mp3/wav/opus), `conversations.mode`, `conversations.interaction_mode` (conversation/simulation), `conversations.status`, `messages.role` (user/assistant/system), `messages.channel` (practice/teacher), `corrections.error_type`, `corrections.severity` (low/medium/high), `words.last_rating` e `word_senses.last_rating` (forgot/hard/good/easy), `review_state` (new/learning/review/difficult/suspended), `word_senses.source` (chat/manual/backfill), `topics.source`, `topics.difficulty` (A1–C2), `practice_sessions.type`, `practice_sessions.status`, `flashcards.card_type`, `flashcards.generation_source` (ai/deterministic/fallback), `flashcard_attempts.match_result` (exact/acceptable/minor_error/incorrect/unknown), `suggested_rating`/`final_rating`. **Todos nullable** (paridade: Teable permite vazio; linhas legadas em branco viram NULL).
- RLS **desabilitado** em todas as tabelas (acesso só via service role, server-side).
- `topics.related_words`: hoje é relation→Words armazenada como texto; migra como `text` (cópia 1:1 do valor atual, paridade total; não vira FK nesta fase).

### Mapeamento de tabelas e campos

Fonte: `lib/teable/schema.ts` + `scripts/ensure-*.mjs`. Tipo Postgres entre parênteses; `→ tabela` = FK.

1. **users**: name (text), avatar_url (text), active_language_id (uuid → language_profiles), timezone (text), created_at (timestamptz), daily_new_cards_quota (integer) *[ensure-daily-queue-fields]*
2. **language_profiles**: user_id (uuid → users), language_code (text), language_name (text), level (text+CHECK), learning_goal (text), correction_style (text+CHECK), audio_enabled (bool), transcript_enabled (bool), calendar_memory_enabled (bool), weekly_conversation_goal (integer), weekly_word_goal (integer), created_at, updated_at (timestamptz)
3. **ai_provider_settings**: user_id (→ users), provider (text+CHECK), base_url (text), api_key_masked (text), chat_model (text), reasoning_model (text), temperature (numeric), max_tokens (integer), is_active (bool), last_test_status (text+CHECK), last_test_at (timestamptz)
4. **voice_provider_settings**: user_id (→ users), provider (text), base_url (text), api_key_masked (text), default_voice (text), speech_speed (numeric), output_format (text+CHECK), is_active (bool), last_test_status (text+CHECK), last_test_at (timestamptz)
5. **conversations**: user_id (→ users), language_profile_id (→ language_profiles), topic_id (→ topics), mode (text+CHECK), interaction_mode (text+CHECK, default 'conversation'), target_user_message_count (integer), status (text+CHECK), started_at, ended_at (timestamptz), duration_seconds (integer), ai_model_used (text), summary (text)
6. **messages**: conversation_id (→ conversations), role (text+CHECK), text (text), audio_url (text), transcript_text (text), language_detected (text), tokens_used (integer), client_request_id (text), channel (text+CHECK, default 'practice'), created_at (timestamptz)
7. **corrections**: conversation_id (→ conversations), message_id (→ messages), original_text (text), corrected_text (text), error_type (text+CHECK), explanation (text), severity (text+CHECK), should_interrupt (bool), created_at (timestamptz)
8. **words**: user_id (→ users), language_profile_id (→ language_profiles), lemma (text), canonical_key (text UNIQUE), display_text (text), forms_json (jsonb), translation (text), part_of_speech (text), familiarity_score (numeric), total_uses (integer), last_used_at, first_used_at, review_due_at (timestamptz), review_interval_days (numeric), review_ease (numeric), review_streak (integer), lapse_count (integer), last_reviewed_at (timestamptz), last_rating (text+CHECK), average_response_time_ms (numeric), review_state (text+CHECK), review_version (text), learning_step (integer), implicit_review_at (timestamptz), leech_flagged_at (timestamptz) *[ensure-srs-v2-fields]*
9. **word_senses**: word_id (→ words), sense_key (text UNIQUE), translation (text), part_of_speech (text), example_sentence (text), source (text+CHECK), is_primary (bool), sense_order (integer), total_uses (integer), review_due_at (timestamptz), review_interval_days (numeric), review_ease (numeric), review_streak (integer), lapse_count (integer), learning_step (integer), last_reviewed_at (timestamptz), last_rating (text+CHECK), average_response_time_ms (numeric), review_state (text+CHECK), review_version (text), leech_flagged_at (timestamptz), created_at (timestamptz)
10. **word_occurrences**: word_id (→ words), occurrence_key (text UNIQUE), conversation_id (→ conversations), message_id (→ messages), used_text (text), sentence_context (text), was_correct (bool), created_at (timestamptz)
11. **word_usage_summaries**: usage_key (text UNIQUE), word_id (→ words), conversation_id (→ conversations), forms_json (jsonb), observed_count (integer), correct_use_count (integer), correction_count (integer), first_used_at, last_used_at (timestamptz)
12. **daily_feedbacks**: user_id (→ users), language_profile_id (→ language_profiles), date (timestamptz), strengths (text), weaknesses (text), recommended_focus (text), recurring_errors (jsonb), new_words_count (integer), correction_score (numeric), fluency_score (numeric), suggested_topics (jsonb), created_at (timestamptz)
13. **topics**: user_id (→ users), language_profile_id (→ language_profiles), title (text), source (text+CHECK), reason (text), related_feedback_id (→ daily_feedbacks), related_words (text), difficulty (text+CHECK), created_at (timestamptz)
14. **practice_sessions**: user_id (→ users), language_profile_id (→ language_profiles), conversation_id (→ conversations), type (text+CHECK), focus (text), status (text+CHECK), started_at, ended_at (timestamptz), duration_seconds (integer), criterion (text), requested_word_count, selected_word_count, unique_card_count, presentation_count, correct_count, incorrect_count (integer), score (numeric), language_code (text), configuration_json (jsonb), parent_session_id (uuid → practice_sessions), created_at, updated_at (timestamptz)
15. **flashcards**: practice_session_id (→ practice_sessions), target_word_id (→ words), target_sense_id (→ word_senses), supporting_word_ids (jsonb), card_type (text+CHECK), prompt (text), expected_answer (text), accepted_answers (jsonb), translation (text), explanation (text), sentence (text), audio_text (text), difficulty (numeric), initial_position (integer), generation_source (text+CHECK), created_at (timestamptz)
16. **flashcard_attempts**: practice_session_id (→ practice_sessions), flashcard_id (→ flashcards), word_id (→ words), sense_id (→ word_senses), presentation_number (integer), client_attempt_id (text), user_answer (text), normalized_answer (text), match_result (text+CHECK), suggested_rating (text+CHECK), final_rating (text+CHECK), was_correct (bool), response_time_ms (numeric), used_speech (bool), audio_replay_count (integer), used_slow_audio (bool), answered_after_audio_replay (bool), audio_failed (bool), review_applied (bool), resulting_review_state (text), review_snapshot (jsonb), undone_at (timestamptz) *[ensure-srs-v2 + flashcard-undo]*, created_at (timestamptz)
17. **app_events**: user_id (→ users), event_name (text not null), payload (jsonb), created_at (timestamptz)

Índices: além das UNIQUEs, índices nas FKs mais consultadas (`messages.conversation_id`, `words.user_id`, `words.language_profile_id`, `flashcards.practice_session_id`, `flashcard_attempts.practice_session_id`, `app_events.user_id`, `conversations.user_id`, `daily_feedbacks.user_id`).

## Migração de dados — `scripts/migrate-teable-to-supabase.mjs`

1. **Backup integral primeiro:** nova execução de backup com paginação completa (corrigir a limitação de 1000 registros de `backup-learning-data.mjs`) → `backups/pre-supabase-migration-<data>.json`. Critério para prosseguir: backup contém contagens ≥ às contagens reportadas pela API do Teable.
2. **Aplicar schema:** executa `supabase/migrations/0001_initial_schema.sql` no projeto (idempotente: `create table if not exists` / guard clauses).
3. **Passada 1 — insert sem FKs:** para cada tabela (ordem: users → language_profiles → ai/voice_provider_settings → topics → conversations → messages → corrections → words → word_senses → word_occurrences → word_usage_summaries → daily_feedbacks → practice_sessions → flashcards → flashcard_attempts → app_events): `listAllRecords`, conversão de tipos (datas ISO, strings JSON → objetos, números, checkboxes), insert em lotes de ~200 com `legacy_id` = id Teable. Monta mapa `legacy_id → uuid` em memória e o persiste em `backups/supabase-id-map-<data>.json`.
4. **Passada 2 — resolver FKs:** update das colunas de relation usando o mapa. Relations que apontam para registros inexistentes viram NULL + warning no relatório (paridade: hoje são texto solto sem garantia).
5. **Verificação automática (gate):**
   - Contagem por tabela: Teable == Supabase (17/17 obrigatório).
   - Amostragem: 5 registros aleatórios por tabela, comparação campo a campo (com parse de JSON e tolerância de formato de data).
   - Falha em qualquer gate → aborta, imprime relatório, **não** sugere cutover.
6. **AppEvents migra por último** (incluído — decisão do usuário: 100% dos dados).
7. Relatório final: contagens, warnings de FKs órfãs, duração — salvo em `backups/supabase-migration-report-<data>.json`.

## Cutover e rollback

- `.env.local`: `DATA_BACKEND=supabase` (default). Rollback instantâneo: `DATA_BACKEND=teable` (Teable permanece intacto e funcional).
- Deploy: adicionar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATA_BACKEND=supabase` nas env vars do Vercel (Production) e redeploy.
- Após validação em produção (critério: checklist manual abaixo + 48h sem erros atribuíveis ao backend), o Teable pode ser desligado **pelo usuário** (fora do escopo deste trabalho).

## QA harness

- `create-qa-env.mjs` adaptado: cria fixtures diretamente no Supabase (user QA próprio + dados associados), via adapter ou supabase-js.
- `qa-fixture.mjs`, `qa-cleanup*.mjs`, `qa-recover-fixture.mjs`, `reset-personal-test-data.mjs`, `production-smoke.mjs`, `inspect-learning-scope.mjs`, `verify-sense-*-live.mjs`: adaptados para o backend ativo (a maioria já passa pelo client/factory — mudança mínima).
- Suporte a `DATA_BACKEND` em todos os scripts de QA, para poder rodar contra qualquer backend durante a transição.

## Testes

- **Unit:** novos testes para `lib/supabase/client.ts` (shape `{id, fields}`, conversão jsonb↔string, filtros, paginação, erros). Suite existente (`tests/unit`) deve passar com `DATA_BACKEND=supabase` sem alterações de assertions.
- **E2E:** `tests/e2e` contra backend Supabase.
- **Checklist manual pós-cutover:** onboarding/perfil, chat com correções (practice + teacher), sessão de flashcards completa com undo, weak words, resumo diário/calendário, tela de palavras, export de dados pessoais, exclusão de histórico, settings (teste de conexão, troca de modelo AI).

## Fora de escopo (fase 2 futura)

- Simplificação de `lib/learning/*` com queries SQL/PostgREST reais (remover client-side filtering).
- Multi-usuário real com RLS e Supabase Auth.
- Remoção física do código `lib/teable/*` e do Teable self-hosted.
- `topics.related_words` como FK/array tipado.

## Arquivos novos e alterados (previsão)

**Novos:** `lib/supabase/config.ts`, `lib/supabase/client.ts`, `supabase/migrations/0001_initial_schema.sql`, `scripts/migrate-teable-to-supabase.mjs`, `tests/unit/supabase-client.test.*`, `backups/supabase-id-map-*.json` (artefato), `backups/supabase-migration-report-*.json` (artefato).

**Alterados:** `lib/teable/index.ts` (factory), `lib/api/responses.ts` (novos erros), `.env.example` (novas vars), `package.json` (dependência + scripts), rotas de diagnóstico (equivalentes Supabase), scripts QA listados acima, `lib/settings/status.ts` (status do backend ativo).

**Intocados (por design do adapter):** `lib/learning/*`, `lib/ai/model-settings.ts`, componentes, e a grande maioria das API routes.
