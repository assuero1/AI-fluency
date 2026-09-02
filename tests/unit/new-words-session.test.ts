// tests/unit/new-words-session.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCompletion, client } = vi.hoisted(() => ({
  createChatCompletion: vi.fn(),
  client: {
    records: new Map<string, { id: string; fields: Record<string, unknown> }>(),
    seq: 0,
    reset() { this.records.clear(); this.seq = 0; },
    async createRecord(table: string, fields: Record<string, unknown>) {
      const id = `${table}-${++this.seq}`;
      this.records.set(id, { id, fields });
      return { id, fields };
    },
    async updateRecord(_table: string, id: string, fields: Record<string, unknown>) {
      const record = this.records.get(id);
      if (!record) throw new Error("not found");
      Object.assign(record.fields, fields);
      return record;
    },
    async listRecordsWhereAll() { return [...this.records.values()] as never; },
    async listRecords() { return [] as never; },
    async listRecordsWhere(_table: string, field: string, value: string) {
      return [...this.records.values()].filter((record) => record.fields[field] === value) as never;
    },
    async createEvent() {}
  }
}));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/supabase/client", () => ({ getTeableClient: () => client, TeableRequestError: class extends Error { status = 409; } }));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: async () => ({ id: "user-1", fields: { timezone: "UTC" } }),
  getActiveLanguageProfile: async () => ({ id: "profile-1", fields: { language_code: "en", language_name: "Inglês", level: "Intermediário (B1)" } })
}));

import { validateGeneratedSentences } from "../../lib/learning/new-words-validation";

describe("geração de frases para palavras novas", () => {
  beforeEach(() => client.reset());

  it("usa somente frases validadas e respeita retries", async () => {
    const { generateSentencesForWords } = await import("../../lib/learning/new-words");
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [{ text: "resposta lixo", translation: "x", word: "bread" }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) });
    const result = await generateSentencesForWords([{ id: "w1", lemma: "bread" }], ["eat", "good", "want"], "Inglês", "B1");
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    expect(result.sentencesByWord.get("w1")).toHaveLength(3);
    expect(result.droppedWordIds).toEqual([]);
  });

  it("valida saída com validateGeneratedSentences (contrato compartilhado)", () => {
    const { sentencesByWord } = validateGeneratedSentences(
      [{ text: "bread is good", translation: "pão é bom", word: "bread" }],
      [{ id: "w1", lemma: "bread" }], ["good"]
    );
    expect(sentencesByWord.get("w1")?.[0].translation).toBe("pão é bom");
  });

  it("start cria a sessão em preparing e devolve na hora", async () => {
    const { startNewWordsPractice } = await import("../../lib/learning/new-words");
    const result = await startNewWordsPractice({ count: 8 });
    expect(result).toEqual({ sessionId: expect.any(String), status: "preparing", requestedWordCount: 8 });
    const session = client.records.get(result.sessionId);
    expect(session?.fields.type).toBe("new_words");
    expect(session?.fields.status).toBe("preparing");
    expect(JSON.parse(String(session?.fields.focus))).toEqual({ count: 8 });
  });

  it("start recusa nova sessão (409) quando já existe uma em preparing", async () => {
    const { startNewWordsPractice } = await import("../../lib/learning/new-words");
    await startNewWordsPractice({ count: 3 });
    await expect(startNewWordsPractice({ count: 3 })).rejects.toMatchObject({ status: 409 });
  });

  it("start recusa (409) com preparing recente de 1 minuto", async () => {
    const { startNewWordsPractice } = await import("../../lib/learning/new-words");
    const recent = new Date(Date.now() - 60_000).toISOString();
    await client.createRecord("practiceSessions", {
      type: "new_words", status: "preparing", focus: JSON.stringify({ count: 3 }), started_at: recent, created_at: recent
    });
    await expect(startNewWordsPractice({ count: 3 })).rejects.toMatchObject({ status: 409 });
  });

  it("start com preparing zumbi de 6 minutos marca failed e cria sessão nova", async () => {
    const { startNewWordsPractice } = await import("../../lib/learning/new-words");
    const stale = new Date(Date.now() - 6 * 60_000).toISOString();
    const zombie = await client.createRecord("practiceSessions", {
      type: "new_words", status: "preparing", focus: JSON.stringify({ count: 3 }), started_at: stale, created_at: stale
    });
    const result = await startNewWordsPractice({ count: 3 });
    expect(result.sessionId).not.toBe(zombie.id);
    expect(client.records.get(zombie.id)?.fields.status).toBe("failed");
    expect(client.records.get(result.sessionId)?.fields.status).toBe("preparing");
  });

  it("getActive com preparing zumbi de 6 minutos devolve failed:true e marca failed", async () => {
    const { getActiveNewWordsPractice } = await import("../../lib/learning/new-words");
    const stale = new Date(Date.now() - 6 * 60_000).toISOString();
    const zombie = await client.createRecord("practiceSessions", {
      type: "new_words", status: "preparing", focus: JSON.stringify({ count: 5 }), started_at: stale, created_at: stale
    });
    expect(await getActiveNewWordsPractice()).toEqual({ preparing: false, failed: true, sessionId: zombie.id });
    expect(client.records.get(zombie.id)?.fields.status).toBe("failed");
  });

  it("recompõe o pedido com a reposição quando a 1ª leva perde palavras", async () => {
    const { startNewWordsPractice, generateNewWordsDeck, getActiveNewWordsPractice } = await import("../../lib/learning/new-words");
    createChatCompletion
      // 1ª leva: propõe 3 palavras para o pedido de 3.
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [
        { lemma: "bread", translation: "pão", part_of_speech: "noun" },
        { lemma: "rice", translation: "arroz", part_of_speech: "noun" },
        { lemma: "water", translation: "água", part_of_speech: "noun" }
      ] }) })
      // Frases da 1ª leva: só bread recebe frases válidas.
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) })
      // 2ª rodada da 1ª leva: rice e water continuam sem frase válida.
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [] }) })
      // Reposição: propõe exatamente as 2 palavras em falta.
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [
        { lemma: "milk", translation: "leite", part_of_speech: "noun" },
        { lemma: "honey", translation: "mel", part_of_speech: "noun" }
      ] }) })
      // Frases da reposição: milk e honey completam o pedido.
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "milk is good", translation: "leite é bom", word: "milk" },
        { text: "I want milk", translation: "eu quero leite", word: "milk" },
        { text: "milk and bread", translation: "leite e pão", word: "milk" },
        { text: "honey is sweet", translation: "mel é doce", word: "honey" },
        { text: "I want honey", translation: "eu quero mel", word: "honey" },
        { text: "honey and milk", translation: "mel e leite", word: "honey" }
      ] }) });
    const { sessionId } = await startNewWordsPractice({ count: 3 });
    await generateNewWordsDeck(sessionId);
    const session = client.records.get(sessionId);
    expect(session?.fields.status).toBe("active");
    expect(session?.fields.unique_card_count).toBe(9);
    const payload = await getActiveNewWordsPractice();
    if (!payload || payload.preparing || payload.failed) throw new Error("esperava sessão ativa pronta");
    expect(payload.words.map((word) => word.lemma)).toEqual(["bread", "milk", "honey"]);
    expect(payload.sentences).toHaveLength(9);
  });

  it("abre a sessão com o que já tem quando a reposição falha", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { startNewWordsPractice, generateNewWordsDeck, getActiveNewWordsPractice } = await import("../../lib/learning/new-words");
      createChatCompletion
        // 1ª leva: propõe 3 palavras, mas só bread recebe frases válidas.
        .mockResolvedValueOnce({ content: JSON.stringify({ words: [
          { lemma: "bread", translation: "pão", part_of_speech: "noun" },
          { lemma: "rice", translation: "arroz", part_of_speech: "noun" },
          { lemma: "water", translation: "água", part_of_speech: "noun" }
        ] }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
          { text: "I eat bread", translation: "eu como pão", word: "bread" },
          { text: "bread is good", translation: "pão é bom", word: "bread" },
          { text: "want bread", translation: "quero pão", word: "bread" }
        ] }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [] }) })
        // Reposição: a IA falha (500 após os retries) — a sessão não pode cair.
        .mockRejectedValue(new Error("ia fora do ar"));
      const { sessionId } = await startNewWordsPractice({ count: 3 });
      await generateNewWordsDeck(sessionId);
      expect(client.records.get(sessionId)?.fields.status).toBe("active");
      const payload = await getActiveNewWordsPractice();
      if (!payload || payload.preparing || payload.failed) throw new Error("esperava sessão ativa pronta");
      expect(payload.words.map((word) => word.lemma)).toEqual(["bread"]);
      expect(payload.sentences).toHaveLength(3);
      expect(warnSpy).toHaveBeenCalledWith("new words: top-up failed", expect.any(Error));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("marca a sessão como failed (sem propagar erro) quando a geração falha", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { startNewWordsPractice, generateNewWordsDeck } = await import("../../lib/learning/new-words");
      createChatCompletion
        .mockResolvedValueOnce({ content: JSON.stringify({ words: [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }] }) })
        .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
          { text: "I eat bread", translation: "eu como pão", word: "bread" },
          { text: "bread is good", translation: "pão é bom", word: "bread" },
          { text: "want bread", translation: "quero pão", word: "bread" }
        ] }) })
        // Reposição não acha palavra nova (só reproõe bread) e desiste sem erro.
        .mockResolvedValueOnce({ content: JSON.stringify({ words: [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }] }) });
      const { sessionId } = await startNewWordsPractice({ count: 3 });
      const originalCreateRecord = client.createRecord.bind(client);
      client.createRecord = async (table: string, fields: Record<string, unknown>) => {
        if (table === "flashcards") throw new Error("falha ao gravar card");
        return originalCreateRecord(table, fields);
      };
      try {
        // A geração roda em background: o erro é sinalizado no status "failed",
        // não propagado.
        await expect(generateNewWordsDeck(sessionId)).resolves.toBeUndefined();
        expect(client.records.get(sessionId)?.fields.status).toBe("failed");
        expect(errorSpy).toHaveBeenCalled();
      } finally {
        client.createRecord = originalCreateRecord;
      }
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("falha da IA marca failed com failedReason no focus e o GET devolve o motivo", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { startNewWordsPractice, generateNewWordsDeck, getActiveNewWordsPractice } = await import("../../lib/learning/new-words");
      // IA fora do ar: toda chamada rejeita (retries incluídos).
      createChatCompletion.mockRejectedValue(new Error("ia fora do ar"));
      const { sessionId } = await startNewWordsPractice({ count: 3 });
      await generateNewWordsDeck(sessionId);
      const session = client.records.get(sessionId);
      expect(session?.fields.status).toBe("failed");
      const focus = JSON.parse(String(session?.fields.focus)) as { failed?: boolean; failedReason?: string };
      expect(focus.failed).toBe(true);
      expect(focus.failedReason).toBe("Não foi possível escolher palavras novas agora. Tente novamente em instantes.");
      // O erro bruto da IA aparece no log de cada tentativa antes da queda final.
      expect(errorSpy).toHaveBeenCalledWith("new words: AI call failed (tentativa 1)", expect.any(Error));
      expect(errorSpy).toHaveBeenCalledWith("new words: deck generation failed", expect.any(Error));
      const payload = await getActiveNewWordsPractice();
      expect(payload).toEqual({ preparing: false, failed: true, sessionId, failedReason: "Não foi possível escolher palavras novas agora. Tente novamente em instantes." });
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("não ativa sessão abandonada durante a geração do deck", async () => {
    const { startNewWordsPractice, generateNewWordsDeck } = await import("../../lib/learning/new-words");
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" }
      ] }) })
      // Reposição não acha palavra nova e desiste sem erro.
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [{ lemma: "bread", translation: "pão", part_of_speech: "noun" }] }) });
    const { sessionId } = await startNewWordsPractice({ count: 3 });
    const originalCreateRecord = client.createRecord.bind(client);
    client.createRecord = async (table: string, fields: Record<string, unknown>) => {
      const record = await originalCreateRecord(table, fields);
      // O usuário abandona enquanto os cards são gravados.
      if (table === "flashcards") client.records.get(sessionId)!.fields.status = "abandoned";
      return record;
    };
    try {
      await generateNewWordsDeck(sessionId);
      expect(client.records.get(sessionId)?.fields.status).toBe("abandoned");
    } finally {
      client.createRecord = originalCreateRecord;
    }
  });

  it("getActiveNewWordsPractice sinaliza preparing e failed recente", async () => {
    const { getActiveNewWordsPractice } = await import("../../lib/learning/new-words");
    const now = new Date().toISOString();
    const session = await client.createRecord("practiceSessions", {
      type: "new_words", status: "preparing", focus: JSON.stringify({ count: 5 }),
      started_at: now, created_at: now, requested_word_count: 5
    });
    expect(await getActiveNewWordsPractice()).toEqual({ preparing: true, sessionId: session.id, requestedWordCount: 5 });
    await client.updateRecord("practiceSessions", session.id, { status: "failed" });
    expect(await getActiveNewWordsPractice()).toEqual({ preparing: false, failed: true, sessionId: session.id });
    // Falha antiga (mais de 10 minutos) é lixo inerte: não aparece para a UI.
    await client.updateRecord("practiceSessions", session.id, { created_at: new Date(Date.now() - 11 * 60_000).toISOString() });
    expect(await getActiveNewWordsPractice()).toBeNull();
  });

  it("retry de propostas traz feedback das recusadas e devolve palavras novas", async () => {
    createChatCompletion.mockClear();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { generateNewWordProposals } = await import("../../lib/learning/new-words");
      createChatCompletion
        // Tentativa 1: 3 candidatas, todas já conhecidas do aluno (validação zera).
        .mockResolvedValueOnce({ content: JSON.stringify({ words: [
          { lemma: "apple", translation: "maçã", part_of_speech: "noun" },
          { lemma: "go", translation: "ir", part_of_speech: "verb" },
          { lemma: "went", translation: "foi", part_of_speech: "verb" }
        ] }) })
        // Tentativa 2: 3 candidatas inéditas.
        .mockResolvedValueOnce({ content: JSON.stringify({ words: [
          { lemma: "bread", translation: "pão", part_of_speech: "noun" },
          { lemma: "milk", translation: "leite", part_of_speech: "noun" },
          { lemma: "honey", translation: "mel", part_of_speech: "noun" }
        ] }) });
      const bank = [
        { lemma: "apple", displayText: "apple", formsJson: '["apples"]' },
        { lemma: "go", displayText: "go", formsJson: '["went","gone"]' }
      ];
      const result = await generateNewWordProposals([{ lemma: "banana", translation: "banana" }], bank, 3, "Inglês", "B1");
      expect(createChatCompletion).toHaveBeenCalledTimes(2);
      expect(result.map((word) => word.lemma)).toEqual(["bread", "milk", "honey"]);
      const attempt1 = createChatCompletion.mock.calls[0][0] as Array<{ role: string; content: string }>;
      const attempt2 = createChatCompletion.mock.calls[1][0] as Array<{ role: string; content: string }>;
      // Tentativa 1 pede o dobro (count 3 → 6 candidatas) e não fala de recusadas.
      expect(attempt1[1].content).toContain("6 candidatas");
      expect(attempt1[1].content).not.toContain("recusadas");
      expect(attempt1[0].content).not.toContain("NÃO repita");
      // Tentativa 2 carrega o bloco de recusadas com os lemmas da tentativa 1.
      expect(attempt2[1].content).toContain("IMPORTANTE: estas palavras foram recusadas por já existirem no vocabulário do aluno ou serem inválidas — escolha OUTRAS completamente diferentes:");
      expect(attempt2[1].content).toContain('["apple","go","went"]');
      expect(attempt2[0].content).toContain("NÃO repita nenhuma palavra da lista de recusadas.");
      // Observabilidade: aceitas/alvo por tentativa e quantas foram pedidas.
      expect(logSpy).toHaveBeenCalledWith("new words: propostas aceitas 0/3 (pedidas 6)");
      expect(logSpy).toHaveBeenCalledWith("new words: propostas aceitas 3/3 (pedidas 6)");
    } finally {
      logSpy.mockRestore();
    }
  });

  it("pede o dobro de candidatas e usa só o pedido na leva principal", async () => {
    createChatCompletion.mockClear();
    const { startNewWordsPractice, generateNewWordsDeck, getActiveNewWordsPractice } = await import("../../lib/learning/new-words");
    createChatCompletion
      // 6 candidatas válidas para um pedido de 3.
      .mockResolvedValueOnce({ content: JSON.stringify({ words: [
        { lemma: "bread", translation: "pão", part_of_speech: "noun" },
        { lemma: "milk", translation: "leite", part_of_speech: "noun" },
        { lemma: "honey", translation: "mel", part_of_speech: "noun" },
        { lemma: "rice", translation: "arroz", part_of_speech: "noun" },
        { lemma: "water", translation: "água", part_of_speech: "noun" },
        { lemma: "cheese", translation: "queijo", part_of_speech: "noun" }
      ] }) })
      // Frases só para as 3 primeiras (6 por palavra) — o excedente é fatiado fora.
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "bread is good", translation: "pão é bom", word: "bread" },
        { text: "want bread", translation: "quero pão", word: "bread" },
        { text: "I have bread", translation: "eu tenho pão", word: "bread" },
        { text: "bread on the table", translation: "pão na mesa", word: "bread" },
        { text: "bread with butter", translation: "pão com manteiga", word: "bread" },
        { text: "milk is good", translation: "leite é bom", word: "milk" },
        { text: "I want milk", translation: "eu quero leite", word: "milk" },
        { text: "milk and bread", translation: "leite e pão", word: "milk" },
        { text: "I have milk", translation: "eu tenho leite", word: "milk" },
        { text: "milk in the cup", translation: "leite na xícara", word: "milk" },
        { text: "she drinks milk", translation: "ela bebe leite", word: "milk" },
        { text: "honey is sweet", translation: "mel é doce", word: "honey" },
        { text: "I want honey", translation: "eu quero mel", word: "honey" },
        { text: "honey and milk", translation: "mel e leite", word: "honey" },
        { text: "I have honey", translation: "eu tenho mel", word: "honey" },
        { text: "honey on the bread", translation: "mel no pão", word: "honey" },
        { text: "they sell honey", translation: "eles vendem mel", word: "honey" }
      ] }) });
    const { sessionId } = await startNewWordsPractice({ count: 3 });
    await generateNewWordsDeck(sessionId);
    // Sem top-up: 1 chamada de propostas + 1 de frases (6 por palavra fecha em 1 rodada).
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    const firstCall = createChatCompletion.mock.calls[0][0] as Array<{ role: string; content: string }>;
    expect(firstCall[1].content).toContain("6 candidatas");
    const session = client.records.get(sessionId);
    expect(session?.fields.status).toBe("active");
    expect(session?.fields.selected_word_count).toBe(3);
    expect(session?.fields.unique_card_count).toBe(18);
    const payload = await getActiveNewWordsPractice();
    if (!payload || payload.preparing || payload.failed) throw new Error("esperava sessão ativa pronta");
    expect(payload.words.map((word) => word.lemma)).toEqual(["bread", "milk", "honey"]);
    expect(payload.sentences).toHaveLength(18);
  });
});

describe("julgamento de tentativas (judgeNewWordsAttempt)", () => {
  beforeEach(() => {
    client.reset();
    // Os testes de geração acima acumulam chamadas na IA: zera para as asserções de chamada abaixo.
    vi.clearAllMocks();
  });

  function seedActiveSession() {
    return (async () => {
      const now = new Date().toISOString();
      const session = await client.createRecord("practiceSessions", {
        type: "new_words", status: "active", focus: JSON.stringify({ count: 1 }), started_at: now, created_at: now
      });
      const word = await client.createRecord("words", { user_id: "user-1", lemma: "bread", display_text: "bread", translation: "pão" });
      const card = await client.createRecord("flashcards", {
        user_id: "user-1", practice_session_id: session.id, card_type: "translation",
        target_word_id: word.id, target_sense_id: "",
        prompt: "I eat bread", sentence: "I eat bread", audio_text: "I eat bread",
        expected_answer: "eu como pão", translation: "eu como pão", initial_position: 0
      });
      return { sessionId: session.id, sentenceId: card.id };
    })();
  }

  it("tradução idêntica à referência pula a IA e persiste match exact / was_correct", async () => {
    const { judgeNewWordsAttempt } = await import("../../lib/learning/new-words");
    const { sessionId, sentenceId } = await seedActiveSession();
    // Se a IA fosse chamada, diria "incorrect": o teste prova que ela nem roda.
    createChatCompletion.mockResolvedValue({ content: JSON.stringify({ verdict: "incorrect", feedback: "não é isso", corrected_translation: "outra coisa" }) });

    const result = await judgeNewWordsAttempt({
      sessionId, clientAttemptId: "attempt-exact-001", sentenceId, userTranslation: "Eu como pão."
    });

    expect(createChatCompletion).not.toHaveBeenCalled();
    expect(result.sentenceId).toBe(sentenceId);
    expect(result.judgment).toEqual({ verdict: "correct", feedback: "Isso mesmo!", correctedTranslation: "eu como pão" });
    expect(result.senseCreated).toBe(false);
    const attempt = [...client.records.values()].find((record) => record.fields.client_attempt_id === "attempt-exact-001");
    expect(attempt?.fields.match_result).toBe("exact");
    expect(attempt?.fields.was_correct).toBe(true);
  });

  it("tradução não-exata continua no fluxo com IA (com fallback se a IA falhar)", async () => {
    const { judgeNewWordsAttempt } = await import("../../lib/learning/new-words");
    const { sessionId, sentenceId } = await seedActiveSession();
    createChatCompletion.mockRejectedValue(new Error("ia fora do ar"));

    const result = await judgeNewWordsAttempt({
      sessionId, clientAttemptId: "attempt-loose-001", sentenceId, userTranslation: "como pão eu"
    });

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    expect(result.judgment.verdict).toBe("incorrect");
    const attempt = [...client.records.values()].find((record) => record.fields.client_attempt_id === "attempt-loose-001");
    expect(attempt?.fields.match_result).toBe("incorrect");
    expect(attempt?.fields.was_correct).toBe(false);
  });
});
