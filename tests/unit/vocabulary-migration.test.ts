import { describe, expect, it } from "vitest";
import { buildVocabularyMigrationPlan } from "../../scripts/migrate-vocabulary-integrity.mjs";

describe("vocabulary integrity migration", () => {
  it("consolidates duplicates only inside the same user and language profile", () => {
    const data = fixture();
    data.words.push(word("word-es", "user-1", "profile-es", "work"));

    const plan = buildVocabularyMigrationPlan(data);

    expect(plan.duplicateGroups).toHaveLength(1);
    expect(plan.duplicateGroups[0].duplicateIds).toEqual(["word-duplicate"]);
    expect(plan.replacements.has("word-es")).toBe(false);
  });

  it("recalculates total uses from correct learner occurrences and moves references", () => {
    const plan = buildVocabularyMigrationPlan(fixture());
    const group = plan.duplicateGroups[0];

    expect(group.keeperId).toBe("word-primary");
    expect(group.mergedFields.total_uses).toBe(2);
    expect(group.occurrenceIds).toEqual(["occurrence-duplicate"]);
    expect(plan.referenceUpdates.flashcards[0]).toMatchObject({ fields: { target_word_id: "word-primary" } });
    expect(plan.referenceUpdates.attempts[0]).toMatchObject({ fields: { word_id: "word-primary" } });
    expect(plan.referenceUpdates.sessions[0].fields.focus).toContain("word-primary");
    expect(plan.referenceUpdates.sessions[0].fields.focus).not.toContain("word-duplicate");
  });

  it("is idempotent after duplicate ids have been consolidated", () => {
    const data = fixture();
    data.words = data.words.filter((item) => item.id !== "word-duplicate");
    data.occurrences = data.occurrences.map((item) => item.id === "occurrence-duplicate" ? { ...item, fields: { ...item.fields, word_id: "word-primary" } } : item);

    expect(buildVocabularyMigrationPlan(data).duplicateGroups).toEqual([]);
  });

  it("audits stale totals even when a word has no duplicate", () => {
    const data = fixture();
    data.words = data.words.filter((item) => item.id === "word-primary");
    data.occurrences = data.occurrences.filter((item) => item.fields.word_id === "word-primary");

    const plan = buildVocabularyMigrationPlan(data);

    expect(plan.recountUpdates).toEqual([{ id: "word-primary", fields: { total_uses: 1, canonical_key: JSON.stringify(["user-1", "profile-en", "work"]) } }]);
  });

  it("detects legacy occurrences whose token was corrected", () => {
    const data = fixture();
    data.corrections = [{ id: "correction-1", fields: { message_id: "message-user-1", original_text: "I work yesterday", corrected_text: "I worked yesterday" } }];

    const plan = buildVocabularyMigrationPlan(data);

    expect(plan.occurrenceCorrectnessUpdates).toContainEqual({ id: "occurrence-primary", fields: { was_correct: false } });
    expect(plan.duplicateGroups[0].mergedFields.total_uses).toBe(1);
  });
});

function fixture() {
  return {
    words: [
      { ...word("word-primary", "user-1", "profile-en", "Work"), createdTime: "2026-01-01T00:00:00.000Z", fields: { ...word("word-primary", "user-1", "profile-en", "Work").fields, translation: "trabalhar" } },
      { ...word("word-duplicate", "user-1", "profile-en", "work"), createdTime: "2026-02-01T00:00:00.000Z" }
    ],
    messages: [
      { id: "message-user-1", fields: { role: "user" } },
      { id: "message-user-2", fields: { role: "user" } },
      { id: "message-assistant", fields: { role: "assistant" } }
    ],
    corrections: [] as Array<{ id: string; fields: Record<string, unknown> }>,
    occurrences: [
      { id: "occurrence-primary", fields: { word_id: "word-primary", message_id: "message-user-1", conversation_id: "conversation-1", used_text: "work", was_correct: true } },
      { id: "occurrence-duplicate", fields: { word_id: "word-duplicate", message_id: "message-user-2", conversation_id: "conversation-2", used_text: "work", was_correct: true } },
      { id: "occurrence-assistant", fields: { word_id: "word-primary", message_id: "message-assistant", conversation_id: "conversation-1", used_text: "work", was_correct: true } },
      { id: "occurrence-wrong", fields: { word_id: "word-primary", message_id: "message-user-1", conversation_id: "conversation-1", used_text: "work", was_correct: false } }
    ],
    flashcards: [{ id: "card-1", fields: { target_word_id: "word-duplicate", supporting_word_ids: "[]" } }],
    attempts: [{ id: "attempt-1", fields: { word_id: "word-duplicate" } }],
    topics: [{ id: "topic-1", fields: { related_words: JSON.stringify(["word-duplicate"]) } }],
    sessions: [{ id: "session-1", fields: { focus: JSON.stringify({ wordIds: ["word-primary", "word-duplicate"], cards: [{ targetWordId: "word-duplicate" }] }) } }]
  };
}

function word(id: string, userId: string, profileId: string, lemma: string) {
  return { id, createdTime: "2026-03-01T00:00:00.000Z", fields: { user_id: userId, language_profile_id: profileId, lemma, display_text: lemma, total_uses: 99 } };
}
