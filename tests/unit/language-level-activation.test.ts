import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageProfileFields, UserFields } from "../../lib/learning/profile";
import type { TeableRecord } from "../../lib/supabase/client";

const user: TeableRecord<UserFields> = { id: "user-a", fields: { Name: "Camila", created_at: "2026-08-13T12:00:00.000Z" } };

function languageProfile(fields: Partial<LanguageProfileFields> = {}): TeableRecord<LanguageProfileFields> {
  return {
    id: "profile-en",
    fields: {
      user_id: user.id,
      language_code: "en",
      language_name: "Inglês",
      level: "Intermediário (B1)",
      learning_goal: "Falar com mais naturalidade em situações reais.",
      correction_style: "Corrigir sempre",
      audio_enabled: true,
      transcript_enabled: true,
      calendar_memory_enabled: true,
      weekly_conversation_goal: 7,
      weekly_word_goal: 500,
      created_at: "2026-08-13T12:00:00.000Z",
      updated_at: "2026-08-13T12:00:00.000Z",
      ...fields
    }
  };
}

const existing = languageProfile();
const listRecords = vi.fn();
const createRecord = vi.fn();
const updateRecord = vi.fn();
const createEvent = vi.fn();
const safeUpdateRecord = vi.fn(async () => null);

vi.mock("../../lib/supabase/client", () => ({
  getTeableClient: () => ({ listRecords, createRecord, updateRecord, createEvent }),
  safeUpdateRecord
}));

describe("createOrActivateLanguageProfile level handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecords.mockResolvedValue([existing]);
    updateRecord.mockImplementation(async (_table: string, id: string, fields: Record<string, unknown>) => ({
      id,
      fields: { ...existing.fields, ...fields }
    }));
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("updates the stored level when a different valid level is provided", async () => {
    const { createOrActivateLanguageProfile } = await import("../../lib/learning/profile");
    const result = await createOrActivateLanguageProfile(user, { language_code: "en", level: "Avançado" });

    expect(updateRecord).toHaveBeenCalledWith(
      "languageProfiles",
      "profile-en",
      expect.objectContaining({ level: "Avançado", updated_at: expect.any(String) })
    );
    expect(createEvent).toHaveBeenCalledWith(
      user.id,
      "language_level_updated",
      expect.objectContaining({ language_code: "en", previous_level: "Intermediário (B1)", level: "Avançado" })
    );
    expect(createEvent).toHaveBeenCalledWith(
      user.id,
      "language_profile_activated",
      expect.objectContaining({ level: "Avançado" })
    );
    expect(result.fields.level).toBe("Avançado");
  });

  it("keeps the stored level when the payload level is missing or invalid", async () => {
    const { createOrActivateLanguageProfile } = await import("../../lib/learning/profile");

    const missing = await createOrActivateLanguageProfile(user, { language_code: "en" });
    expect(missing.fields.level).toBe("Intermediário (B1)");

    const invalid = await createOrActivateLanguageProfile(user, { language_code: "en", level: "Expert" });
    expect(invalid.fields.level).toBe("Intermediário (B1)");

    expect(updateRecord).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalledWith(user.id, "language_level_updated", expect.anything());
    expect(createEvent).toHaveBeenCalledWith(
      user.id,
      "language_profile_activated",
      expect.objectContaining({ level: "Intermediário (B1)" })
    );
  });

  it("does not rewrite the level when the payload level matches the stored one", async () => {
    const { createOrActivateLanguageProfile } = await import("../../lib/learning/profile");
    const result = await createOrActivateLanguageProfile(user, { language_code: "en", level: "Intermediário (B1)" });

    expect(result.fields.level).toBe("Intermediário (B1)");
    expect(updateRecord).not.toHaveBeenCalled();
    expect(createEvent).not.toHaveBeenCalledWith(user.id, "language_level_updated", expect.anything());
    expect(createEvent).toHaveBeenCalledWith(
      user.id,
      "language_profile_activated",
      expect.objectContaining({ level: "Intermediário (B1)" })
    );
  });
});

describe("createLanguageProfile level validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecords.mockResolvedValue([]);
    createRecord.mockImplementation(async (_table: string, fields: Record<string, unknown>) => ({
      id: "profile-new",
      fields
    }));
    createEvent.mockResolvedValue({ id: "event-a", fields: {} });
  });

  it("stores the provided level when it is a valid language level", async () => {
    const { createLanguageProfile } = await import("../../lib/learning/profile");
    const result = await createLanguageProfile(user, { language_code: "en", level: "Avançado" });

    expect(createRecord).toHaveBeenCalledWith(
      "languageProfiles",
      expect.objectContaining({ level: "Avançado" })
    );
    expect(result.fields.level).toBe("Avançado");
  });

  it("falls back to the default level when the payload level is invalid", async () => {
    const { createLanguageProfile } = await import("../../lib/learning/profile");
    const result = await createLanguageProfile(user, { language_code: "en", level: "Expert" });

    expect(createRecord).toHaveBeenCalledWith(
      "languageProfiles",
      expect.objectContaining({ level: "Intermediário (B1)" })
    );
    expect(result.fields.level).toBe("Intermediário (B1)");
  });
});
