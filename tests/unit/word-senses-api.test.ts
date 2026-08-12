import { beforeEach, describe, expect, it, vi } from "vitest";
import { LearningStateError } from "../../lib/learning/access";

const addManualWordSense = vi.fn();

vi.mock("../../lib/learning/words", () => ({ addManualWordSense }));

async function postSenses(body: string, wordId = "word-banco") {
  const { POST } = await import("../../app/api/words/[wordId]/senses/route");
  return POST(new Request(`http://localhost/api/words/${wordId}/senses`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body
  }), { params: Promise.resolve({ wordId }) });
}

describe("POST /api/words/[wordId]/senses", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards a normalized manual sense and returns 201", async () => {
    addManualWordSense.mockResolvedValue({ id: "sense-new", translation: "banco (parque)", isPrimary: false, source: "manual", reviewState: "new" });
    const response = await postSenses(JSON.stringify({ translation: "  banco (parque)  ", partOfSpeech: "noun", exampleSentence: "Nos vimos en el banco." }));

    expect(response.status).toBe(201);
    expect(addManualWordSense).toHaveBeenCalledWith("word-banco", { translation: "banco (parque)", partOfSpeech: "noun", exampleSentence: "Nos vimos en el banco." });
    expect(await response.json()).toMatchObject({ ok: true, sense: { id: "sense-new", source: "manual" } });
  });

  it("omits optional fields when they are not strings", async () => {
    addManualWordSense.mockResolvedValue({ id: "sense-new" });
    const response = await postSenses(JSON.stringify({ translation: "banco (parque)", partOfSpeech: 42 }));

    expect(response.status).toBe(201);
    expect(addManualWordSense).toHaveBeenCalledWith("word-banco", { translation: "banco (parque)", partOfSpeech: undefined, exampleSentence: undefined });
  });

  it("requires a non-empty translation and rejects invalid JSON with 422", async () => {
    for (const body of [JSON.stringify({}), JSON.stringify({ translation: "   " }), "not json"]) {
      const response = await postSenses(body);
      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ ok: false, error: "Informe a tradução do significado." });
    }
    expect(addManualWordSense).not.toHaveBeenCalled();
  });

  it("maps a duplicate sense conflict to 409 with a clear message", async () => {
    addManualWordSense.mockRejectedValue(new LearningStateError("Este significado já existe para esta palavra.", 409));
    const response = await postSenses(JSON.stringify({ translation: "banco (instituição)" }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, error: "Este significado já existe para esta palavra." });
  });

  it("maps an out-of-scope word to 404", async () => {
    addManualWordSense.mockRejectedValue(new LearningStateError("Palavra não encontrada no seu vocabulário ativo.", 404));
    const response = await postSenses(JSON.stringify({ translation: "banco (parque)" }), "word-foreign");

    expect(response.status).toBe(404);
    expect(addManualWordSense).toHaveBeenCalledWith("word-foreign", expect.objectContaining({ translation: "banco (parque)" }));
  });
});
