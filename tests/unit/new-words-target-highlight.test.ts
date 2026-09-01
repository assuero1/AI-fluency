import { describe, expect, it } from "vitest";
import { splitSentenceAroundTarget } from "../../lib/learning/new-words-contracts";

describe("splitSentenceAroundTarget", () => {
  it("separa a ocorrência exata da palavra-alvo", () => {
    expect(splitSentenceAroundTarget("I schedule the fixture today.", "schedule")).toEqual({
      before: "I ",
      match: "schedule",
      after: " the fixture today."
    });
  });

  it("é case-insensitive e preserva a forma original", () => {
    expect(splitSentenceAroundTarget("Schedule it now.", "schedule")?.match).toBe("Schedule");
  });

  it("não casa palavra dentro de outra palavra", () => {
    expect(splitSentenceAroundTarget("The rescheduled game.", "schedule")).toBeNull();
  });

  it("devolve null quando a palavra não está na frase", () => {
    expect(splitSentenceAroundTarget("Nothing here.", "schedule")).toBeNull();
  });
});
