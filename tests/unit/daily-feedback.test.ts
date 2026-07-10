import { describe, expect, it } from "vitest";
import { aggregateDailyFeedback } from "../../lib/learning/feedback";

describe("daily feedback aggregation", () => {
  it("keeps one daily record and merges a second completed conversation deterministically", () => {
    const result = aggregateDailyFeedback(
      {
        user_id: "user-1",
        language_profile_id: "profile-1",
        date: "2026-07-09",
        strengths: "Primeira conversa",
        weaknesses: "Passado simples",
        recommended_focus: "Praticar passado",
        recurring_errors: JSON.stringify(["tense"]),
        new_words_count: 3,
        correction_score: 6,
        fluency_score: 7,
        suggested_topics: JSON.stringify([{ title: "Rotina", reason: "Revisar verbos" }]),
        created_at: "2026-07-09T08:00:00.000Z"
      },
      {
        correction_score: 10,
        fluency_score: 9,
        strengths: "Segunda conversa",
        weaknesses: "Preposições",
        recommended_focus: "Praticar preposições",
        recurring_errors: ["tense", "preposition"],
        suggested_topics: [
          { title: "Rotina", reason: "Duplicada" },
          { title: "Restaurante", reason: "Usar preposições" }
        ]
      },
      2,
      1,
      {
        Name: "2026-07-09",
        user_id: "user-1",
        language_profile_id: "profile-1",
        date: "2026-07-09",
        created_at: "2026-07-09T08:00:00.000Z"
      }
    );

    expect(result.new_words_count).toBe(5);
    expect(result.correction_score).toBe(8);
    expect(result.fluency_score).toBe(8);
    expect(JSON.parse(result.recurring_errors)).toEqual(["tense", "preposition"]);
    expect(JSON.parse(result.suggested_topics)).toHaveLength(2);
    expect(result.recommended_focus).toBe("Praticar preposições");
  });
});
