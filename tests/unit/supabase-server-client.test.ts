import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    getAll: () => [{ name: "sb-token", value: "abc" }],
    set: vi.fn()
  }))
}));

// Passthrough espião: mantém a criação real do client e captura as options.
const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn()
}));

vi.mock("@supabase/ssr", async (importActual) => {
  const actual = await importActual<typeof import("@supabase/ssr")>();
  mocks.createServerClient.mockImplementation(actual.createServerClient);
  return { ...actual, createServerClient: mocks.createServerClient };
});

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

  it("falha com erro claro sem SUPABASE_URL", async () => {
    process.env.SUPABASE_ANON_KEY = "anon-key";
    delete process.env.SUPABASE_URL;
    vi.resetModules();
    const { getRequestSupabaseClient } = await import("@/lib/supabase/server");
    await expect(getRequestSupabaseClient()).rejects.toThrow(/SUPABASE_URL/);
  });

  it("desabilita retries internos do postgrest-js e aplica fetch com timeout", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    mocks.createServerClient.mockClear();
    vi.resetModules();
    const { getRequestSupabaseClient } = await import("@/lib/supabase/server");
    await getRequestSupabaseClient();
    expect(mocks.createServerClient).toHaveBeenCalledTimes(1);
    const options = mocks.createServerClient.mock.calls[0][2] as Record<string, never>;
    expect(options).toMatchObject({ db: { retry: false } });
    expect(typeof (options as { global?: { fetch?: unknown } }).global?.fetch).toBe("function");
  });
});
