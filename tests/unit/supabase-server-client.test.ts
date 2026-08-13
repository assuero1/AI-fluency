import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [{ name: "sb-token", value: "abc" }],
    set: vi.fn()
  }))
}));

describe("getRequestSupabaseClient", () => {
  it("cria client server-side a partir dos cookies da request", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    const { getRequestSupabaseClient } = await import("@/lib/supabase/server");
    const client = await getRequestSupabaseClient();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
    expect(typeof client.auth.getUser).toBe("function");
  });

  it("falha com erro claro sem SUPABASE_ANON_KEY", async () => {
    delete process.env.SUPABASE_ANON_KEY;
    vi.resetModules();
    const { getRequestSupabaseClient } = await import("@/lib/supabase/server");
    await expect(getRequestSupabaseClient()).rejects.toThrow(/SUPABASE_ANON_KEY/);
  });
});
