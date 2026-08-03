import { describe, expect, it } from "vitest";
import { buildSuggestions } from "../../lib/learning/home";

describe("Home suggestions", () => {
  it("shows an honest empty state instead of invented recommendations", () => {
    expect(buildSuggestions([], null, [])).toEqual([]);
  });

  it("labels persisted suggestion provenance", () => {
    const suggestions = buildSuggestions(
      [
        {
          id: "topic-1",
          fields: {
            user_id: "user-1",
            language_profile_id: "profile-1",
            title: "Entrevista",
            source: "recurring_error",
            reason: "Praticar tempos verbais.",
            related_feedback_id: "",
            related_words: "",
            difficulty: "B1",
            created_at: "2026-07-09T10:00:00.000Z"
          }
        }
      ],
      null,
      []
    );

    expect(suggestions[0]).toMatchObject({ title: "Entrevista", badge: "Erro recorrente", source: "recurring_error" });
  });

  it("reflects the daily queue in the weak-words hook", () => {
    const suggestions = buildSuggestions([], null, [
      {
        id: "w1",
        fields: {
          user_id: "user-1",
          language_profile_id: "profile-1",
          lemma: "casa",
          display_text: "casa",
          translation: "house",
          part_of_speech: "noun",
          familiarity_score: 0,
          total_uses: 1,
          last_used_at: "2026-08-01T10:00:00.000Z",
          first_used_at: "2026-07-01T10:00:00.000Z",
          review_due_at: "2026-08-01T09:00:00.000Z"
        }
      }
    ], { dueCount: 3, newCount: 2 });

    expect(suggestions[0]).toMatchObject({ source: "weak_words", meta: "Hoje: 3 revisões + 2 novas na sua fila." });
  });
});
