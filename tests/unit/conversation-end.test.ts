import { beforeEach, describe, expect, it, vi } from "vitest";

type TestRecord = { id: string; fields: Record<string, unknown> };

const createChatCompletion = vi.fn();
const listRecords = vi.fn();
const listAllRecords = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();
const createEvent = vi.fn();
const getConversation = vi.fn();

vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ listRecords, listAllRecords, createRecord, updateRecord, createEvent })
}));
vi.mock("../../lib/learning/conversations", () => ({ getConversation, startConversation: vi.fn() }));
vi.mock("../../lib/learning/home", () => ({}));
vi.mock("../../lib/learning/profile", () => ({
  getActiveLanguageProfile: vi.fn(),
  getOrCreatePersonalUser: vi.fn()
}));
vi.mock("../../lib/learning/topics", () => ({ createTopic: vi.fn() }));
vi.mock("../../lib/learning/flashcards", () => ({}));

describe("endConversation idempotency", () => {
  let conversation: TestRecord;
  let dailyFeedbacks: TestRecord[];
  let conversations: TestRecord[];

  beforeEach(() => {
    conversation = {
      id: "conversation-1",
      fields: {
        Name: "Rotina",
        user_id: "user-1",
        language_profile_id: "profile-1",
        status: "active",
        mode: "free_talk",
        started_at: "2026-07-10T09:00:00.000Z"
      }
    };
    dailyFeedbacks = [];
    conversations = [conversation];
    vi.clearAllMocks();
    createChatCompletion.mockResolvedValue({ content: "{}", tokensUsed: 1 });
    getConversation.mockImplementation(async (id: string) => id === conversation.id
      ? {
          conversation,
          topicTitle: "Rotina",
          messages: [{ id: "message-1", fields: { role: "user", text: "hello there" } }],
          corrections: [],
          profile: { id: "profile-1", fields: { language_code: "en" } }
        }
      : null);
    listRecords.mockImplementation(async (table: string) => table === "dailyFeedbacks"
      ? [...dailyFeedbacks]
      : table === "conversations"
        ? [...conversations]
        : []);
    listAllRecords.mockImplementation(async () => []);
    createEvent.mockResolvedValue(undefined);
    createRecord.mockImplementation(async (table: string, fields: Record<string, unknown>) => {
      const record = { id: `${table}-${dailyFeedbacks.length + 1}`, fields: { ...fields } };
      if (table === "dailyFeedbacks") dailyFeedbacks.push(record);
      return record;
    });
    updateRecord.mockImplementation(async (table: string, id: string, fields: Record<string, unknown>) => {
      const target = (table === "conversations" ? conversations : dailyFeedbacks).find((item) => item.id === id)!;
      Object.assign(target.fields, fields);
      return target;
    });
  });

  it("creates a single daily feedback when two calls race", async () => {
    const { endConversation } = await import("../../lib/learning/feedback");

    const [first, second] = await Promise.all([
      endConversation("conversation-1"),
      endConversation("conversation-1")
    ]);

    expect(first.redirectTo).toContain("/resumo");
    expect(second.redirectTo).toContain("/resumo");
    expect(dailyFeedbacks).toHaveLength(1);
    expect(createRecord.mock.calls.filter(([table]) => table === "dailyFeedbacks")).toHaveLength(1);
    expect(conversation.fields.status).toBe("completed");
  });

  it("returns the persisted completion without reprocessing once completed", async () => {
    const { endConversation } = await import("../../lib/learning/feedback");

    const first = await endConversation("conversation-1");
    const second = await endConversation("conversation-1");

    expect(dailyFeedbacks).toHaveLength(1);
    expect(createRecord.mock.calls.filter(([table]) => table === "dailyFeedbacks")).toHaveLength(1);
    expect(second.dailyFeedback.id).toBe(first.dailyFeedback.id);
    expect(second.redirectTo).toBe(first.redirectTo);
  });
});
