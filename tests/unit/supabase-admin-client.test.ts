import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn<(url: string, key: string, options?: Record<string, unknown>) => { from: ReturnType<typeof vi.fn> }>(
    () => ({ from: vi.fn() })
  )
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient
}));

describe("createServiceRoleClient", () => {
  it("falha com erro claro sem SUPABASE_SERVICE_ROLE_KEY", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.resetModules();
    const { createServiceRoleClient } = await import("@/lib/supabase/admin");
    expect(() => createServiceRoleClient()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("falha com erro claro sem SUPABASE_URL", async () => {
    delete process.env.SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    vi.resetModules();
    const { createServiceRoleClient } = await import("@/lib/supabase/admin");
    expect(() => createServiceRoleClient()).toThrow(/SUPABASE_URL/);
  });

  it("mantém auth sem sessão, desabilita retries internos e aplica fetch com timeout", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    mocks.createClient.mockClear();
    vi.resetModules();
    const { createServiceRoleClient } = await import("@/lib/supabase/admin");
    createServiceRoleClient();
    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    const options = mocks.createClient.mock.calls[0][2];
    expect(options).toMatchObject({
      auth: { persistSession: false, autoRefreshToken: false },
      db: { retry: false }
    });
    expect(typeof (options as { global?: { fetch?: unknown } }).global?.fetch).toBe("function");
  });
});
