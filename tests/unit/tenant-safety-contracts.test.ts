import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/**
 * Contratos dos consertos de segurança da auditoria (2026-08-30): cap de
 * mensagem, rate limit, idempotência no banco e isolamento cross-tenant.
 */
describe("tenant safety contracts", () => {
  it("caps the chat user message at the shared 2000-char limit, server and client", () => {
    const contracts = read("lib/learning/chat-contracts.ts");
    expect(contracts).toContain("export const MAX_USER_MESSAGE_LENGTH = 2000;");
    const conversations = read("lib/learning/conversations.ts");
    expect(conversations).toContain("cleanText.length > MAX_USER_MESSAGE_LENGTH");
    const teacher = read("lib/learning/conversation-teacher.ts");
    expect(teacher).toContain("cleanText.length > MAX_USER_MESSAGE_LENGTH");
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("maxLength={MAX_USER_MESSAGE_LENGTH}");
  });

  it("rate-limits expensive API routes in the middleware with Retry-After", () => {
    const middleware = read("lib/supabase/middleware.ts");
    expect(middleware).toContain('matchApiRateLimitRule(pathname)');
    expect(middleware).toContain("checkRateLimit(");
    expect(middleware).toContain('"Retry-After"');
    expect(middleware).toContain("status: 429");
    const limiter = read("lib/api/rate-limit.ts");
    expect(limiter).toContain("export const apiRateLimitRules");
    expect(limiter).toMatch(/voice-synthesize[\s\S]*limitPerMinute: 30/);
    expect(limiter).toMatch(/chat-message[\s\S]*limitPerMinute: 12/);
  });

  it("enforces idempotency with unique indexes in migration 0005", () => {
    const migration = read("supabase/migrations/0005_idempotency_unique_indexes.sql");
    expect(migration).toContain("create unique index if not exists messages_conversation_client_request_id_uidx");
    expect(migration).toContain("create unique index if not exists flashcard_attempts_session_client_attempt_id_uidx");
    expect(migration).toContain("create unique index if not exists daily_feedbacks_user_profile_date_uidx");
    // Índices parciais: '' (registro sem id de dedupe) não participa.
    expect(migration.match(/where client_request_id is not null and client_request_id <> ''/g)).toHaveLength(1);
    expect(migration.match(/where client_attempt_id is not null and client_attempt_id <> ''/g)).toHaveLength(1);
  });

  it("requires parent ownership in child-table RLS insert/update policies (0006)", () => {
    const migration = read("supabase/migrations/0006_child_tenant_ownership_rls.sql");
    const childTables = ["messages", "corrections", "word_senses", "word_occurrences", "word_usage_summaries", "flashcards", "flashcard_attempts"];
    for (const table of childTables) {
      expect(migration).toContain(`drop policy if exists ${table}_insert_own on public.${table}`);
      expect(migration).toContain(`create policy ${table}_insert_own on public.${table} for insert`);
      expect(migration).toContain(`create policy ${table}_update_own on public.${table} for update`);
    }
    // Posse do pai: cada folha aponta para a raiz de posse correta.
    expect(migration).toContain("from public.conversations c");
    expect(migration).toContain("from public.words w");
    expect(migration).toContain("from public.practice_sessions ps");
    expect(migration).toContain("from public.flashcards f");
    // Idioma do initplan: (select public.current_user_id()) em vez de chamada
    // por linha.
    expect(migration).toContain("user_id = (select public.current_user_id())");
  });

  it("applies every migration in order and validates RLS in the schema script", () => {
    const script = read("scripts/apply-supabase-schema.mjs");
    expect(script).toContain("supabase/migrations");
    expect(script).toContain(".sort()");
    expect(script).toContain("relrowsecurity");
    expect(script).toContain("pg_policies");
    expect(script).toContain("RLS desativado");
  });
});
