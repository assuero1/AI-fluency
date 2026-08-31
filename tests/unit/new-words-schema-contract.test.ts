import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/0007_new_words_session.sql", "utf8");

describe("new words session schema contract", () => {
  it("extends practice_sessions.type with new_words", () => {
    expect(migration).toMatch(/practice_sessions_type_check/);
    expect(migration).toMatch(/'new_words'/);
  });
  it("extends flashcards.card_type with translation", () => {
    expect(migration).toMatch(/flashcards_card_type_check/);
    expect(migration).toMatch(/'translation'/);
  });
  it("extends word_senses.source with session", () => {
    expect(migration).toMatch(/word_senses_source_check/);
    expect(migration).toMatch(/'session'/);
  });
  it("adds judgment_json to flashcard_attempts", () => {
    expect(migration).toMatch(/add column if not exists judgment_json jsonb/);
  });
});
