import { beforeEach, describe, expect, it, vi } from "vitest";

type TestRecord = { id: string; fields: Record<string, unknown> };

const createChatCompletion = vi.fn();
const createRecord = vi.fn();
const listRecordsWhere = vi.fn();
const getRecord = vi.fn();
const createEvent = vi.fn();
const getExistingPersonalUser = vi.fn();
const getActiveLanguageProfile = vi.fn();
const getTutorContext = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ createRecord, listRecordsWhere, getRecord, createEvent }),
  TeableRequestError: class TeableRequestError extends Error {
    status = 500;
  }
}));
vi.mock("../../lib/learning/profile", () => ({ getExistingPersonalUser, getActiveLanguageProfile }));
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

const { parseLearningAnalysis, sendConversationMessage } = await import("../../lib/learning/conversations");

describe("turno estruturado do chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getExistingPersonalUser.mockResolvedValue({ id: "user-1", fields: {} });
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
