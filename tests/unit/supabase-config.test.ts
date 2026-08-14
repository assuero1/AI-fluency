import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseConfig, getSupabaseStatus, isSupabaseConfigured } from "@/lib/supabase/config";

describe("lib/supabase/config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports not configured when env vars are missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(isSupabaseConfigured()).toBe(false);
    expect(getSupabaseConfig()).toEqual({ url: undefined, serviceRoleKey: undefined });
  });

  it("reports configured when both env vars are set", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(isSupabaseConfigured()).toBe(true);
  });

  it("getSupabaseStatus never leaks the raw key", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key-secret");
    const status = getSupabaseStatus();
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("service-key-secret");
  });
});
