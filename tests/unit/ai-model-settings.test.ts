import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listRecords: vi.fn(),
  updateRecord: vi.fn(),
  createRecord: vi.fn()
}));

vi.mock("@/lib/teable/client", () => ({
  getTeableClient: () => mocks
}));

import { getActiveModelOverride, invalidateModelCache, saveModelOverride } from "@/lib/ai/model-settings";

describe("getActiveModelOverride", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T12:00:00Z"));
    invalidateModelCache();
    mocks.listRecords.mockReset();
    mocks.updateRecord.mockReset();
    mocks.createRecord.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns env source when there are no records", async () => {
    mocks.listRecords.mockResolvedValue([]);
    const result = await getActiveModelOverride();
    expect(result).toEqual({ chatModel: null, source: "env" });
    expect(mocks.listRecords).toHaveBeenCalledWith("aiProviderSettings", 100);
  });

  it("returns the most recent active row with a chat_model", async () => {
    mocks.listRecords.mockResolvedValue([
      { id: "rec1", createdTime: "2026-07-01T00:00:00Z", fields: { is_active: true, chat_model: "old-model" } },
      { id: "rec2", createdTime: "2026-08-01T00:00:00Z", fields: { is_active: true, chat_model: "new-model" } },
      { id: "rec3", createdTime: "2026-08-02T00:00:00Z", fields: { is_active: false, chat_model: "inactive-model" } }
    ]);
    const result = await getActiveModelOverride();
    expect(result).toEqual({ chatModel: "new-model", source: "teable" });
  });

  it("falls back to env silently when Teable throws", async () => {
    mocks.listRecords.mockRejectedValue(new Error("connection refused"));
    const result = await getActiveModelOverride();
    expect(result).toEqual({ chatModel: null, source: "env" });
  });

  it("caches the result for 60 seconds", async () => {
    mocks.listRecords.mockResolvedValue([]);
    await getActiveModelOverride();
    await getActiveModelOverride();
    expect(mocks.listRecords).toHaveBeenCalledTimes(1);

    vi.setSystemTime(new Date("2026-08-02T12:01:01Z"));
    await getActiveModelOverride();
    expect(mocks.listRecords).toHaveBeenCalledTimes(2);
  });
});

describe("saveModelOverride", () => {
  beforeEach(() => {
    invalidateModelCache();
    mocks.listRecords.mockReset();
    mocks.updateRecord.mockReset();
    mocks.createRecord.mockReset();
  });

  it("updates the existing active row", async () => {
    mocks.listRecords.mockResolvedValue([
      { id: "rec1", createdTime: "2026-08-01T00:00:00Z", fields: { is_active: true, chat_model: "old" } }
    ]);
    await saveModelOverride("deepseek-reasoner");
    expect(mocks.updateRecord).toHaveBeenCalledWith("aiProviderSettings", "rec1", { chat_model: "deepseek-reasoner" });
    expect(mocks.createRecord).not.toHaveBeenCalled();
  });

  it("creates a row when there is no active one", async () => {
    vi.stubEnv("AI_PROVIDER", "deepseek");
    mocks.listRecords.mockResolvedValue([]);
    await saveModelOverride("deepseek-chat");
    expect(mocks.createRecord).toHaveBeenCalledWith("aiProviderSettings", {
      provider: "deepseek",
      chat_model: "deepseek-chat",
      is_active: true
    });
    vi.unstubAllEnvs();
  });

  it("invalidates the cache after saving", async () => {
    mocks.listRecords.mockResolvedValue([]);
    await getActiveModelOverride();
    expect(mocks.listRecords).toHaveBeenCalledTimes(1);
    await saveModelOverride("deepseek-chat");
    await getActiveModelOverride();
    // 1ª get (1) + saveModelOverride consulta a linha ativa (2) + 2ª get após invalidação (3)
    expect(mocks.listRecords).toHaveBeenCalledTimes(3);
  });

  it("propagates Teable errors", async () => {
    mocks.listRecords.mockRejectedValue(new Error("boom"));
    await expect(saveModelOverride("x")).rejects.toThrow("boom");
  });
});
