import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeableConfigError } from "@/lib/teable/types";

type BuilderResult = { data: unknown; error: unknown };

// Query builder thenable: cada método retorna o próprio builder; await resolve data/error.
function makeBuilder(result: BuilderResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "range", "eq", "is", "insert", "update", "delete"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: BuilderResult) => unknown) => resolve(result);
  return builder;
}

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  createClient: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient
}));

import { createSupabaseTeableClient, SupabaseTeableClient } from "@/lib/supabase/client";

describe("SupabaseTeableClient", () => {
  beforeEach(() => {
    vi.stubEnv("SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
    mocks.from.mockReset();
    mocks.createClient.mockReset();
    mocks.createClient.mockReturnValue({ from: mocks.from });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws TeableConfigError when env is missing", () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(() => new SupabaseTeableClient()).toThrow(TeableConfigError);
  });

  it("listRecords returns {id, fields} and stringifies jsonb columns", async () => {
    mocks.from.mockReturnValue(makeBuilder({
      data: [{ id: "uuid-1", legacy_id: "rec1", lemma: "hola", forms_json: ["hola", "holas"], total_uses: 3, created_at: null }],
      error: null
    }));
    const client = createSupabaseTeableClient();
    const records = await client.listRecords("words");
    expect(mocks.from).toHaveBeenCalledWith("words");
    expect(records).toEqual([
      {
        id: "uuid-1",
        createdTime: undefined,
        fields: { lemma: "hola", forms_json: "[\"hola\",\"holas\"]", total_uses: 3, created_at: null }
      }
    ]);
    expect(records[0].fields).not.toHaveProperty("legacy_id");
  });

  it("createRecord parses JSON strings into jsonb and converts empty strings to null", async () => {
    const builder = makeBuilder({ data: { id: "uuid-9", payload: { a: 1 }, event_name: "evt", created_at: "2026-08-12T00:00:00Z" }, error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    await client.createRecord("appEvents", { event_name: "evt", payload: "{\"a\":1}", user_id: "" });
    expect(builder.insert).toHaveBeenCalledWith({ event_name: "evt", payload: { a: 1 }, user_id: null });
  });

  it("createRecord rejects invalid JSON strings for jsonb columns", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: null, error: null }));
    const client = createSupabaseTeableClient();
    await expect(client.createRecord("appEvents", { event_name: "evt", payload: "{not json" })).rejects.toThrow(/Invalid JSON/);
  });

  it("getRecord falls back to legacy_id for non-uuid ids", async () => {
    const builder = makeBuilder({ data: [{ id: "uuid-1", legacy_id: "recABC", name: "Personal" }], error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    const record = await client.getRecord("users", "recABC");
    expect(builder.eq).toHaveBeenCalledWith("legacy_id", "recABC");
    expect(record).toEqual({ id: "uuid-1", createdTime: undefined, fields: { name: "Personal" } });
  });

  it("getRecord throws 404 TeableRequestError when missing", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: [], error: null }));
    const client = createSupabaseTeableClient();
    await expect(client.getRecord("users", "00000000-0000-0000-0000-000000000000")).rejects.toThrow(/not found/);
  });

  it("listRecordsWhereAll maps empty-string filters to IS NULL", async () => {
    const builder = makeBuilder({ data: [], error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    await client.listRecordsWhereAll("messages", [
      { field: "conversation_id", value: "uuid-1" },
      { field: "channel", value: "" }
    ]);
    expect(builder.eq).toHaveBeenCalledWith("conversation_id", "uuid-1");
    expect(builder.is).toHaveBeenCalledWith("channel", null);
  });

  it("createEvent stringifies payload like the Teable client", async () => {
    const builder = makeBuilder({ data: { id: "uuid-e", event_name: "test", payload: {}, created_at: "2026-08-12T00:00:00Z" }, error: null });
    mocks.from.mockReturnValue(builder);
    const client = createSupabaseTeableClient();
    await client.createEvent("uuid-user", "test", { hello: "world" });
    expect(builder.insert).toHaveBeenCalledWith({
      user_id: "uuid-user",
      event_name: "test",
      payload: { hello: "world" },
      created_at: expect.any(String)
    });
  });

  it("wraps supabase errors into TeableRequestError with status 502", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: null, error: { message: "permission denied" } }));
    const client = createSupabaseTeableClient();
    await expect(client.listRecords("users")).rejects.toThrow(/permission denied/);
  });
});
