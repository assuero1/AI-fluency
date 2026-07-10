import { describe, expect, it } from "vitest";
import { buildStructuredTutorPrompt, parseLearningAnalysis } from "../../lib/learning/conversations";
import { formatTutorContext } from "../../lib/learning/tutor-context";

describe("tutor personalization context", () => {
  const context = {
    dueWords: ["breakfast", "actually"],
    recurringErrors: [{ type: "tense", example: "I go -> I went" }],
    recentTopics: ["Viagem", "Trabalho remoto"],
    calendarFocus: "Praticar passado simples.",
    recentHistory: []
  };

  it("includes due words, recurring errors, topics, and calendar focus in the prompt", () => {
    const prompt = buildStructuredTutorPrompt(null, "Rotina", "Praticar perguntas", context);
    expect(prompt).toContain("breakfast, actually");
    expect(prompt).toContain("tense (I go -> I went)");
    expect(prompt).toContain("Viagem, Trabalho remoto");
    expect(prompt).toContain("Praticar passado simples.");
    expect(prompt).toContain("não como entrevistador");
    expect(prompt).toContain("Perguntas são opcionais");
    expect(prompt).not.toContain("ending with one question");
  });

  it("does not add calendar context when it is disabled upstream", () => {
    expect(formatTutorContext({ ...context, calendarFocus: undefined })).not.toContain("calendário");
  });
});

describe("structured tutor output", () => {
  it("persists only well-formed AI corrections and words", () => {
    const analysis = parseLearningAnalysis(JSON.stringify({
      assistant_reply: "Great. What did you do next?",
      corrections: [
        { original: "I go", corrected: "I went", explanation: "Passado simples.", error_type: "tense", severity: "medium", should_interrupt: true },
        { original: "", corrected: "ignored", explanation: "invalid" }
      ],
      words: [
        { display_text: "breakfast", lemma: "breakfast", translation: "café da manhã", part_of_speech: "noun", context: "I had breakfast.", was_correct: true },
        { display_text: "", lemma: "ignored" }
      ]
    }));

    expect(analysis.assistant_reply).toContain("What did you do next");
    expect(analysis.corrections).toHaveLength(1);
    expect(analysis.words).toHaveLength(1);
  });

  it("uses a tutor-only fallback for malformed JSON without inventing learning records", () => {
    const analysis = parseLearningAnalysis('{"assistant_reply":');
    expect(analysis.assistant_reply).toContain("exploring this topic together");
    expect(analysis.corrections).toEqual([]);
    expect(analysis.words).toEqual([]);
  });

  it("never exposes a technical pattern error as the tutor reply", () => {
    const analysis = parseLearningAnalysis("The string did not match the expected pattern");
    expect(analysis.assistant_reply).not.toMatch(/expected pattern/i);
    expect(analysis.corrections).toEqual([]);
  });
});
