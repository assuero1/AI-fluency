import { beforeEach, describe, expect, it, vi } from "vitest";

const createRecord = vi.fn();
const createEvent = vi.fn();
const listRecords = vi.fn();
const assertPracticeReady = vi.fn();
const getAiConfig = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/ai/config", () => ({ getAiConfig }));
vi.mock("../../lib/supabase/client", () => ({
  getTeableClient: () => ({ createRecord, createEvent, listRecords, getRecord: vi.fn() }),
  TeableRequestError: class TeableRequestError extends Error {
    status = 500;
  }
}));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: vi.fn(),
  getActiveLanguageProfile: vi.fn()
}));
vi.mock("../../lib/learning/tutor-context", () => ({
  getTutorContext: vi.fn(),
  formatTutorContext: () => ""
}));
vi.mock("../../lib/learning/topics", () => ({ createTopic: vi.fn() }));
vi.mock("../../lib/learning/access", () => ({
  assertPracticeReady,
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

const { startConversation } = await import("../../lib/learning/conversations");

describe("conversation start configuration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    assertPracticeReady.mockResolvedValue({
      client: { createRecord, createEvent, listRecords, getRecord: vi.fn() },
      user: { id: "user-1", fields: {} },
      profile: { id: "profile-1", fields: { language_code: "en" } }
    });
    getAiConfig.mockResolvedValue({ chatModel: "mock-model" });
    listRecords.mockResolvedValue([]);
    createEvent.mockResolvedValue({});
    createRecord.mockImplementation(async (_table: string, fields: Record<string, unknown>) => ({
      id: `record-${createRecord.mock.calls.length}`,
      fields
    }));
  });

  it("defaults to conversation without a message goal for legacy clients", async () => {
    const result = await startConversation({ mode: "free_conversation", title: "Conversa livre" });

    expect(result.conversation.fields.interaction_mode).toBe("conversation");
    expect(result.conversation.fields.target_user_message_count).toBe(0);
    expect(createRecord).toHaveBeenCalledWith(
      "conversations",
      expect.objectContaining({ interaction_mode: "conversation", target_user_message_count: 0 })
    );
    const practiceSessionCall = createRecord.mock.calls.find((call) => call[0] === "practiceSessions");
    expect(practiceSessionCall).toBeDefined();
    expect(practiceSessionCall![1]).toMatchObject({
      configuration_json: JSON.stringify({ interactionMode: "conversation", targetUserMessageCount: 0 })
    });
  });

  it("persists simulation and a target of 8 learner messages", async () => {
    const result = await startConversation({
      mode: "free_conversation",
      title: "Conversa livre",
      interactionMode: "simulation",
      targetUserMessageCount: 8
    });

    expect(result.conversation.fields.interaction_mode).toBe("simulation");
    expect(result.conversation.fields.target_user_message_count).toBe(8);
    expect(createRecord).toHaveBeenCalledWith(
      "conversations",
      expect.objectContaining({ interaction_mode: "simulation", target_user_message_count: 8 })
    );
    const practiceSessionCall = createRecord.mock.calls.find((call) => call[0] === "practiceSessions");
    expect(practiceSessionCall![1]).toMatchObject({
      configuration_json: JSON.stringify({ interactionMode: "simulation", targetUserMessageCount: 8 })
    });
    const event = createEvent.mock.calls.find((call) => call[1] === "conversation_started");
    expect(event?.[2]).toMatchObject({ interactionMode: "simulation", targetUserMessageCount: 8 });
  });

  it.each(["roleplay", 1, null])("rejects an explicit invalid interaction mode: %j", async (interactionMode) => {
    await expect(
      startConversation({ mode: "free_conversation", title: "Conversa livre", interactionMode })
    ).rejects.toMatchObject({ status: 422 });
  });

  it.each([-1, 1.5, 51, "10"])("rejects an invalid message target: %j", async (targetUserMessageCount) => {
    await expect(
      startConversation({ mode: "free_conversation", title: "Conversa livre", targetUserMessageCount })
    ).rejects.toMatchObject({ status: 422 });
  });
});
