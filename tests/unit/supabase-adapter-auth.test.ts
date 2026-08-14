import { describe, expect, it, vi } from "vitest";

describe("SupabaseTeableClient com client injetado", () => {
  it("usa o client injetado para listRecords", async () => {
    const single = vi.fn(async () => ({ data: { id: "uuid-1", created_at: "2026-01-01" }, error: null }));
    const limit = vi.fn(() => ({ data: [{ id: "uuid-1", created_at: "2026-01-01" }], error: null }));
    const order = vi.fn(() => ({ limit }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    const fakeClient = { from };

    const { SupabaseTeableClient } = await import("@/lib/supabase/client");
    const adapter = new SupabaseTeableClient(Promise.resolve(fakeClient as never));
    const records = await adapter.listRecords("users", 5);

    expect(from).toHaveBeenCalledWith("users");
    expect(records[0]?.id).toBe("uuid-1");
  });
});
