import { beforeEach, describe, expect, it, vi } from "vitest";

type TestRecord = { id: string; fields: Record<string, unknown> };

const createChatCompletion = vi.fn();
const createRecord = vi.fn();
const listRecordsWhere = vi.fn();
const getRecord = vi.fn();
const createEvent = vi.fn();
const getSessionUser = vi.fn();
const getActiveLanguageProfile = vi.fn();
const getTutorContext = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/supabase/client", () => ({
  getTeableClient: () => ({ createRecord, listRecordsWhere, getRecord, createEvent }),
  TeableRequestError: class TeableRequestError extends Error {
    status = 500;
  }
}));
vi.mock("../../lib/learning/profile", () => ({ getSessionUser, getActiveLanguageProfile }));
vi.mock("../../lib/learning/tutor-context", () => ({
  getTutorContext,
  formatTutorContext: () => ""
}));
vi.mock("../../lib/learning/topics", () => ({ createTopic: vi.fn() }));
vi.mock("../../lib/learning/access", () => ({
  assertPracticeReady: vi.fn(),
  LearningStateError: class LearningStateError extends Error {
    constructor(
      message: string,
      public status = 400
    ) {
      super(message);
    }
  }
}));
vi.mock("../../lib/learning/conversation-state", () => ({
  isMutableConversationStatus: () => true,
  selectScopedConversation: vi.fn()
}));
vi.mock("../../lib/learning/quick-actions", () => ({ getConversationQuickActionPrompt: vi.fn() }));

const {
  buildStructuredTutorPrompt,
  buildTutorSystemPrompt,
  getConversationWithTutorStart,
  parseLearningAnalysis,
  runConversationQuickAction,
  sendConversationMessage
} = await import("../../lib/learning/conversations");

describe("turno estruturado do chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionUser.mockResolvedValue({ id: "user-1", fields: {} });
    getActiveLanguageProfile.mockResolvedValue({
      id: "profile-1",
      fields: { language_code: "en", language_name: "Inglês", level: "B1" }
    });
    getTutorContext.mockResolvedValue({});
    getRecord.mockImplementation(async (table: string, id: string) => {
      if (table === "conversations") {
        return {
          id,
          fields: {
            Name: "Chat",
            user_id: "user-1",
            language_profile_id: "profile-1",
            topic_id: "",
            status: "active",
            started_at: "2026-08-01T00:00:00.000Z"
          }
        };
      }
      return null;
    });
    listRecordsWhere.mockResolvedValue([]);
    createEvent.mockResolvedValue({});
    createRecord.mockImplementation(async (_table: string, fields: Record<string, unknown>): Promise<TestRecord> => ({
      id: `record-${createRecord.mock.calls.length}`,
      fields
    }));
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify({ assistant_reply: "Nice point!", corrections: [], words: [] }),
      tokensUsed: 10
    });
  });

  it("pede JSON mode, thinking desligado e orçamento de tokens suficiente ao modelo", async () => {
    await sendConversationMessage("conv-1", "I goes to school yesterday.");

    expect(createChatCompletion).toHaveBeenCalledTimes(1);
    const options = createChatCompletion.mock.calls[0][1];
    expect(options.responseFormat).toBe("json");
    expect(options.disableThinking).toBe(true);
    expect(options.maxTokens).toBeGreaterThanOrEqual(1200);
  });

  it("mantém a correção quando o modelo responde JSON válido", async () => {
    createChatCompletion.mockResolvedValue({
      content: JSON.stringify({
        assistant_reply: "Almost! Try again.",
        corrections: [
          {
            original: "I goes",
            corrected: "I went",
            error_type: "grammar",
            explanation: "Use o passado simples.",
            severity: "medium",
            should_interrupt: true
          }
        ],
        words: []
      }),
      tokensUsed: 10
    });

    const result = await sendConversationMessage("conv-1", "I goes to school yesterday.");

    expect(result.corrections).toHaveLength(1);
    expect(result.assistantMessage.fields.text).toBe("Almost! Try again.");
  });

  it("keeps legacy and practice messages in the main transcript and excludes teacher messages from AI history", async () => {
    listRecordsWhere.mockImplementation(async (table: string) => {
      if (table === "messages") {
        return [
          { id: "m1", fields: { conversation_id: "conv-1", role: "assistant", text: "Hello!", created_at: "2026-08-01T00:00:00.000Z" } },
          { id: "m2", fields: { conversation_id: "conv-1", role: "user", text: "Hi!", created_at: "2026-08-01T00:00:01.000Z" } },
          { id: "m3", fields: { conversation_id: "conv-1", role: "user", text: "Teacher secret", channel: "teacher", created_at: "2026-08-01T00:00:02.000Z" } }
        ];
      }
      return [];
    });

    const result = await sendConversationMessage("conv-1", "Another message", "client-id-123");

    const historyMessages = createChatCompletion.mock.calls[0][0] as Array<{ content: string }>;
    const historyText = historyMessages.map((message) => message.content).join("\n");
    expect(historyText).toContain("Hello!");
    expect(historyText).toContain("Hi!");
    expect(historyText).not.toContain("Teacher secret");
    expect(result.userMessage.fields.channel).toBe("practice");
  });

  it("writes practice channel on user, assistant, opening and quick-action messages", async () => {
    await sendConversationMessage("conv-1", "Hello there", "client-id-456");
    const messagesCreated = createRecord.mock.calls.filter((call) => call[0] === "messages");
    expect(messagesCreated.some((call) => call[1].role === "user" && call[1].channel === "practice")).toBe(true);
    expect(messagesCreated.some((call) => call[1].role === "assistant" && call[1].channel === "practice")).toBe(true);

    createRecord.mockClear();
    listRecordsWhere.mockResolvedValue([]);
    createChatCompletion.mockResolvedValue({ content: "Let's start!", tokensUsed: 5 });
    await getConversationWithTutorStart("conv-1");
    expect(createRecord.mock.calls.some((call) => call[0] === "messages" && call[1].role === "assistant" && call[1].channel === "practice")).toBe(true);

    createRecord.mockClear();
    await runConversationQuickAction("conv-1", "repeat");
    expect(createRecord.mock.calls.some((call) => call[0] === "messages" && call[1].role === "assistant" && call[1].channel === "practice")).toBe(true);
  });
});

describe("interaction mode prompts", () => {
  it("keeps conversation rules in the conversation prompt", () => {
    const prompt = buildTutorSystemPrompt(null, "Rotina");
    expect(prompt).toContain("Aja como um professor de conversação presente na conversa, não como entrevistador ou questionário.");
    expect(prompt).toContain("Primeiro reaja ao que o aluno disse");
  });

  it("keeps the structured conversation partner rules by default", () => {
    const prompt = buildStructuredTutorPrompt(null, "Rotina");
    expect(prompt).toContain("Aja como um professor de conversação presente na conversa, não como entrevistador ou questionário.");
  });

  it("makes the simulation prompt stay in a complementary role in both builders", () => {
    const system = buildTutorSystemPrompt(null, "Pedir café na padaria", "", undefined, "simulation");
    const structured = buildStructuredTutorPrompt(null, "Pedir café na padaria", "", undefined, "simulation");
    for (const prompt of [system, structured]) {
      expect(prompt).toContain("Assuma o papel complementar mais plausível para o cenário e permaneça nesse personagem.");
      expect(prompt).toContain("O usuário representa a outra pessoa da situação.");
      expect(prompt).toContain("Não narre as duas partes, não escreva a fala do usuário e não interrompa a cena para dar aula.");
      expect(prompt).toContain("Abra e continue a situação como uma interação real no idioma-alvo.");
      expect(prompt).toContain("sua mensagem ao aluno deve permanecer em personagem");
    }
  });
});

describe("parseLearningAnalysis fallback", () => {
  it("registra aviso quando a resposta é JSON truncado/inválido", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const analysis = parseLearningAnalysis('{"assistant_reply": "That is a good');

    expect(analysis.assistant_reply).toBe("That makes sense. We can keep exploring this topic together.");
    expect(analysis.corrections).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
