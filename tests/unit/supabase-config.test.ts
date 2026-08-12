import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseConfig, getSupabaseStatus, isSupabaseConfigured, resolveDataBackend } from "@/lib/supabase/config";

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

  it("resolveDataBackend honors explicit DATA_BACKEND", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    vi.stubEnv("DATA_BACKEND", "teable");
    expect(resolveDataBackend()).toBe("teable");
    vi.stubEnv("DATA_BACKEND", "supabase");
    expect(resolveDataBackend()).toBe("supabase");
  });

  it("resolveDataBackend defaults to supabase when configured, teable otherwise", () => {
    vi.stubEnv("DATA_BACKEND", "");
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    expect(resolveDataBackend()).toBe("supabase");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(resolveDataBackend()).toBe("teable");
  });

  it("getSupabaseStatus never leaks the raw key", () => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key-secret");
    const status = getSupabaseStatus();
    expect(status.configured).toBe(true);
    expect(JSON.stringify(status)).not.toContain("service-key-secret");
  });
});
