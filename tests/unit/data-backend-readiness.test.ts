import { describe, expect, it } from "vitest";
import { isDataBackendReady } from "../../lib/settings/status";

type Status = Parameters<typeof isDataBackendReady>[0];

function makeStatus(overrides: {
  backend?: Status["backend"];
  teable?: Partial<Status["teable"]>;
  supabase?: Partial<Status["supabase"]>;
}): Status {
  return {
    backend: overrides.backend ?? "teable",
    teable: { configured: true, mappedTableCount: 3, totalTableCount: 3, ...overrides.teable } as Status["teable"],
    supabase: { configured: true, ...overrides.supabase } as Status["supabase"]
  } as Status;
}

describe("isDataBackendReady", () => {
  it("uses supabase.configured when the supabase backend is active", () => {
    expect(isDataBackendReady(makeStatus({
      backend: "supabase",
      teable: { configured: false, mappedTableCount: 0 },
      supabase: { configured: true }
    }))).toBe(true);
    expect(isDataBackendReady(makeStatus({
      backend: "supabase",
      supabase: { configured: false }
    }))).toBe(false);
  });

  it("keeps requiring the fully mapped Teable schema on the teable backend", () => {
    expect(isDataBackendReady(makeStatus({ backend: "teable" }))).toBe(true);
    expect(isDataBackendReady(makeStatus({
      backend: "teable",
      teable: { mappedTableCount: 2 },
      supabase: { configured: true }
    }))).toBe(false);
    expect(isDataBackendReady(makeStatus({
      backend: "teable",
      teable: { configured: false }
    }))).toBe(false);
  });
});
