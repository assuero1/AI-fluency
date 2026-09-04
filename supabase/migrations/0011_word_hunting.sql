-- 0011: Word Hunting — suporte a missões de vocabulário no chat de conversação
-- Aditivo e idempotente.

alter table public.conversations add column if not exists hunt_words jsonb;
