import { describe, expect, it, vi } from "vitest";
import { getTeableClient } from "@/lib/supabase/client";
import { SupabaseTeableClient } from "@/lib/supabase/client";

// O adapter resolve o client autenticado lazy a partir dos cookies da request;
// fora de uma request (teste unitário), injetamos um fake.
vi.mock("@/lib/supabase/server", () => ({
  getRequestSupabaseClient: vi.fn(async () => ({ from: vi.fn() }))
}));

describe("getTeableClient factory", () => {
  it("always returns the Supabase adapter (single data backend)", () => {
    expect(getTeableClient()).toBeInstanceOf(SupabaseTeableClient);
  });
});
