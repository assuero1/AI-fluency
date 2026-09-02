import { beforeEach, describe, expect, it, vi } from "vitest";

const { newWords } = vi.hoisted(() => ({ newWords: {
  getActiveNewWordsPractice: vi.fn(),
  startNewWordsPractice: vi.fn(),
  generateNewWordsDeck: vi.fn(),
  judgeNewWordsAttempt: vi.fn(),
  completeNewWordsPractice: vi.fn(),
  abandonNewWordsPractice: vi.fn()
} }));
vi.mock("../../lib/learning/new-words", () => newWords);
// O after() do Next executa a callback só depois da resposta; nos testes ela
// roda na hora (mantemos o restante do módulo real — as rotas usam NextResponse).
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (callback: () => unknown) => callback()
}));

import { GET as getRoute, POST as postRoute } from "../../app/api/practice/new-words/route";
import { POST as judgeRoute } from "../../app/api/practice/new-words/judge/route";
import { POST as completeRoute } from "../../app/api/practice/new-words/complete/route";
import { POST as abandonRoute } from "../../app/api/practice/new-words/abandon/route";

const jsonRequest = (body: unknown) => new Request("http://localhost/api/practice/new-words", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
});

describe("rotas /api/practice/new-words", () => {
  beforeEach(() => vi.clearAllMocks());

  it("GET devolve a sessão ativa", async () => {
    newWords.getActiveNewWordsPractice.mockResolvedValue({ sessionId: "s1", sentences: [] });
    const response = await getRoute();
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.activeSession.sessionId).toBe("s1");
  });

  it("POST responde na hora com a sessão em preparing e agenda a geração do deck", async () => {
    newWords.startNewWordsPractice.mockResolvedValue({ sessionId: "s1", status: "preparing", requestedWordCount: 5 });
    newWords.generateNewWordsDeck.mockResolvedValue(undefined);
    const response = await postRoute(jsonRequest({ count: 5 }));
    const data = await response.json();
    expect(response.status).toBe(201);
    expect(data).toMatchObject({ ok: true, sessionId: "s1", status: "preparing", requestedWordCount: 5 });
    expect(newWords.startNewWordsPractice).toHaveBeenCalledWith({ count: 5 });
    // after() mockado executa na hora: o deck é gerado com o sessionId devolvido.
    expect(newWords.generateNewWordsDeck).toHaveBeenCalledWith("s1");
  });

  it("POST repassa o 409 de sessão em andamento e não gera deck", async () => {
    const { LearningStateError } = await import("../../lib/learning/access");
    newWords.startNewWordsPractice.mockRejectedValue(new LearningStateError("Você já possui uma sessão de palavras novas em andamento. Continue-a antes de iniciar outra.", 409));
    const response = await postRoute(jsonRequest({ count: 5 }));
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toContain("em andamento");
    expect(newWords.generateNewWordsDeck).not.toHaveBeenCalled();
  });

  it("judge repassa o body e devolve o julgamento", async () => {
    newWords.judgeNewWordsAttempt.mockResolvedValue({ sentenceId: "c1", judgment: { verdict: "correct" }, rating: "good", senseCreated: false });
    const response = await judgeRoute(jsonRequest({ sessionId: "s1", clientAttemptId: "attempt-0001", sentenceId: "c1", userTranslation: "eu como pão" }));
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.attempt.judgment.verdict).toBe("correct");
  });

  it("complete devolve o resultado", async () => {
    newWords.completeNewWordsPractice.mockResolvedValue({ score: 100, sentenceCount: 3 });
    const response = await completeRoute(jsonRequest({ sessionId: "s1", clientCompletionId: "complete-0001" }));
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.score).toBe(100);
  });

  it("abandon devolve status abandoned", async () => {
    newWords.abandonNewWordsPractice.mockResolvedValue({ sessionId: "s1", status: "abandoned" });
    const response = await abandonRoute(jsonRequest({ sessionId: "s1" }));
    const data = await response.json();
    expect(data.ok).toBe(true);
    expect(data.status).toBe("abandoned");
  });

  it("GET sem sessão ativa devolve null", async () => {
    newWords.getActiveNewWordsPractice.mockResolvedValue(null);
    const response = await getRoute();
    const data = await response.json();
    expect(data.activeSession).toBeNull();
  });
});
