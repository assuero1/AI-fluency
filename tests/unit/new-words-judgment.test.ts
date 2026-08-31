import { describe, expect, it } from "vitest";
import { fallbackJudgment, mapVerdictToMatch, sanitizeJudgment } from "../../lib/learning/new-words-validation";

describe("julgamento de tradução", () => {
  it("mapeia vereditos para match_result", () => {
    expect(mapVerdictToMatch("correct")).toBe("exact");
    expect(mapVerdictToMatch("acceptable")).toBe("acceptable");
    expect(mapVerdictToMatch("minor_error")).toBe("minor_error");
    expect(mapVerdictToMatch("incorrect")).toBe("incorrect");
  });

  it("sanitiza julgamento da IA e limita tamanho do feedback", () => {
    const judgment = sanitizeJudgment(
      { verdict: "acceptable", feedback: "  Também está certo!  ".repeat(20), corrected_translation: "eu como pão", new_sense_translation: "pão francês" },
      "eu como pão"
    );
    expect(judgment?.verdict).toBe("acceptable");
    expect(judgment?.feedback.startsWith("Também")).toBe(true);
    expect(judgment!.feedback.length).toBeLessThanOrEqual(300);
    expect(judgment?.newSenseTranslation).toBe("pão francês");
  });

  it("descarta julgamento malformado", () => {
    expect(sanitizeJudgment({ verdict: "otimo" }, "x")).toBeNull();
    expect(sanitizeJudgment(null, "x")).toBeNull();
  });

  it("fallback determinístico aceita tradução igual e rejeita diferente", () => {
    expect(fallbackJudgment("Eu como pão.", "eu como pão").verdict).toBe("correct");
    expect(fallbackJudgment("não sei", "eu como pão").verdict).toBe("incorrect");
  });
});
