-- Idempotência garantida pelo banco. Até aqui o dedupe era read-then-insert em
-- aplicação (conversations.ts / conversation-teacher.ts / flashcards.ts) com
-- lock apenas em memória: duas requisições concorrentes (dobro clique, retry,
-- mais de uma instância) inseriam duplicatas, rodavam o tutor duas vezes e
-- aplicavam a revisão SRS em dobro. Índices únicos parciais ignoram NULL e ''
-- (registros sem id de dedupe).

-- 1. Dedupe de resíduos antes de criar os índices (mantém o registro mais
--    recente de cada chave; falhas antigas de concorrência podem ter gravado
--    duplicatas).
delete from public.messages a
  using public.messages b
  where a.client_request_id <> ''
    and b.conversation_id = a.conversation_id
    and b.client_request_id = a.client_request_id
    and (b.created_at, b.id) > (a.created_at, a.id);

delete from public.flashcard_attempts a
  using public.flashcard_attempts b
  where a.client_attempt_id <> ''
    and b.practice_session_id = a.practice_session_id
    and b.client_attempt_id = a.client_attempt_id
    and (b.created_at, b.id) > (a.created_at, a.id);

delete from public.daily_feedbacks a
  using public.daily_feedbacks b
  where b.user_id = a.user_id
    and b.language_profile_id = a.language_profile_id
    and b.date = a.date
    and (b.created_at, b.id) > (a.created_at, a.id);

-- 2. Índices únicos. messages.client_request_id só existe na mensagem do
--    usuário (a resposta do assistente grava NULL), por isso o índice não
--    conflita com o turno completo.
create unique index if not exists messages_conversation_client_request_id_uidx
  on public.messages (conversation_id, client_request_id)
  where client_request_id is not null and client_request_id <> '';

create unique index if not exists flashcard_attempts_session_client_attempt_id_uidx
  on public.flashcard_attempts (practice_session_id, client_attempt_id)
  where client_attempt_id is not null and client_attempt_id <> '';

create unique index if not exists daily_feedbacks_user_profile_date_uidx
  on public.daily_feedbacks (user_id, language_profile_id, date);
