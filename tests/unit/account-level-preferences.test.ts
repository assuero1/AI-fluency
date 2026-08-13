import { beforeEach, describe, expect, it, vi } from "vitest";

const user = { id: "user-a", fields: { Name: "Camila" } };
const profile = {
  id: "profile-en",
  fields: {
    user_id: user.id,
    language_code: "en",
    language_name: "Inglês",
    level: "Intermediário (B1)",
    correction_style: "Corrigir sempre",
    audio_enabled: true,
    transcript_enabled: true,
    calendar_memory_enabled: true,
    weekly_conversation_goal: 7,
    weekly_word_goal: 500,
    updated_at: "2026-08-13T12:00:00.000Z"
  }
};

const updateRecord = vi.fn();
const createEvent = vi.fn();

vi.mock("../../lib/learning/profile", () => ({
  getOrCreatePersonalUser: vi.fn(async () => user),
  getActiveLanguageProfile: vi.fn(async () => profile),
  getDailyNewCardsQuota: vi.fn(() => 10)
}));
vi.mock("../../lib/teable/client", () => ({
  getTeableClient: () => ({ updateRecord, createEvent }),
  safeUpdateRecord: vi.fn(async () => null)
}));

describe("updatePreferences level", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updateRecord.mockImplementation(async (_table: string, id: string, fields: Record<string, unknown>) => ({
      id,
      fields: { ...profile.fields, ...fields }
    }));
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("persists a valid level on the active language profile", async () => {
    const { updatePreferences } = await import("../../lib/learning/account");
    const updated = await updatePreferences({ level: "Iniciante" });

    expect(updateRecord).toHaveBeenCalledWith(
      "languageProfiles",
      "profile-en",
      expect.objectContaining({ level: "Iniciante", updated_at: expect.any(String) })
    );
    expect(updated.fields.level).toBe("Iniciante");
  });

  it("rejects an unsupported level", async () => {
    const { updatePreferences, AccountValidationError } = await import("../../lib/learning/account");

    await expect(updatePreferences({ level: "Expert" })).rejects.toThrow(AccountValidationError);
    await expect(updatePreferences({ level: "Expert" })).rejects.toThrow("Nível de conhecimento inválido.");
    expect(updateRecord).not.toHaveBeenCalled();
  });
});
