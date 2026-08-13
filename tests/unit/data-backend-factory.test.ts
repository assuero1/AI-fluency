import { afterEach, describe, expect, it, vi } from "vitest";
import { getTeableClient } from "@/lib/teable/client";
import { SupabaseTeableClient } from "@/lib/supabase/client";
import { TeableClient } from "@/lib/teable/client";

// O adapter resolve o client autenticado lazy a partir dos cookies da request;
// fora de uma request (teste unitário), injetamos um fake.
vi.mock("@/lib/supabase/server", () => ({
  getRequestSupabaseClient: vi.fn(async () => ({ from: vi.fn() }))
}));

describe("getTeableClient factory", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns TeableClient when DATA_BACKEND=teable even with Supabase configured", () => {
    vi.stubEnv("DATA_BACKEND", "teable");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("TEABLE_BASE_URL", "https://teable.local");
    vi.stubEnv("TEABLE_API_KEY", "token");
    expect(getTeableClient()).toBeInstanceOf(TeableClient);
  });

  it("returns SupabaseTeableClient when DATA_BACKEND=supabase", () => {
    vi.stubEnv("DATA_BACKEND", "supabase");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(getTeableClient()).toBeInstanceOf(SupabaseTeableClient);
  });

  it("defaults to SupabaseTeableClient when Supabase is configured and DATA_BACKEND is unset", () => {
    vi.stubEnv("DATA_BACKEND", "");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(getTeableClient()).toBeInstanceOf(SupabaseTeableClient);
  });
});
