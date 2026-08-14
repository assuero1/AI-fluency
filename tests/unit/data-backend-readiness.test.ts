import { describe, expect, it } from "vitest";
import { isDataBackendReady } from "../../lib/settings/status";

type Status = Parameters<typeof isDataBackendReady>[0];

function makeStatus(overrides: { supabase?: Partial<Status["supabase"]> }): Status {
  return {
    supabase: { configured: true, ...overrides.supabase } as Status["supabase"]
  } as Status;
}

describe("isDataBackendReady", () => {
  it("is ready when Supabase is configured (single data backend)", () => {
    expect(isDataBackendReady(makeStatus({}))).toBe(true);
  });

  it("is not ready when Supabase is not configured", () => {
    expect(isDataBackendReady(makeStatus({ supabase: { configured: false } }))).toBe(false);
  });
});
