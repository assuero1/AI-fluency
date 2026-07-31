import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TeableClient } from "../../lib/teable/client";

const ENV_KEYS = ["TEABLE_BASE_URL", "TEABLE_API_KEY", "TEABLE_MESSAGES_TABLE_ID", "TEABLE_CONVERSATIONS_TABLE_ID"];
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
const fetchMock = vi.fn();

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("teable filtered listing", () => {
  beforeEach(() => {
    process.env.TEABLE_BASE_URL = "https://teable.example";
    process.env.TEABLE_API_KEY = "test-token";
    process.env.TEABLE_MESSAGES_TABLE_ID = "tblMessages";
    process.env.TEABLE_CONVERSATIONS_TABLE_ID = "tblConversations";
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns server-filtered rows when the filter is honored", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        records: [
          { id: "msg-1", fields: { conversation_id: "conv-1", text: "hi" } },
          { id: "msg-2", fields: { conversation_id: "conv-1", text: "there" } }
        ]
      })
    );

    const records = await new TeableClient().listRecordsWhere("messages", "conversation_id", "conv-1");

    expect(records.map((record) => record.id)).toEqual(["msg-1", "msg-2"]);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/api/table/tblMessages/record?");
    expect(url).toContain("fieldKeyType=name");
    expect(url).toContain(
      `filter=${encodeURIComponent(
        JSON.stringify({ conjunction: "and", filterSet: [{ fieldId: "conversation_id", operator: "is", value: "conv-1" }] })
      )}`
    );
  });

  it("falls back to a client-side filter when the server ignores the filter param", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          records: [
            { id: "msg-1", fields: { conversation_id: "conv-1" } },
            { id: "msg-x", fields: { conversation_id: "conv-other" } }
          ]
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          records: [
            { id: "msg-1", fields: { conversation_id: "conv-1" } },
            { id: "msg-x", fields: { conversation_id: "conv-other" } },
            { id: "msg-2", fields: { conversation_id: "conv-1" } }
          ]
        })
      );

    const records = await new TeableClient().listRecordsWhere("messages", "conversation_id", "conv-1");

    expect(records.map((record) => record.id)).toEqual(["msg-1", "msg-2"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("filter=");
  });

  it("keeps paginating while a full page of filtered rows comes back", async () => {
    const fullPage = Array.from({ length: 1000 }, (_, index) => ({ id: `msg-${index}`, fields: { conversation_id: "conv-1" } }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ records: fullPage }))
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: "msg-1000", fields: { conversation_id: "conv-1" } }] }));

    const records = await new TeableClient().listRecordsWhere("messages", "conversation_id", "conv-1");

    expect(records).toHaveLength(1001);
    expect(String(fetchMock.mock.calls[1][0])).toContain("skip=1000");
  });

  it("fetches a single record by id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "conv-1", fields: { status: "active" } }));

    const record = await new TeableClient().getRecord<{ status?: string }>("conversations", "conv-1");

    expect(record.id).toBe("conv-1");
    expect(record.fields.status).toBe("active");
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/table/tblConversations/record/conv-1?");
  });
});

describe("teable request resilience", () => {
  beforeEach(() => {
    process.env.TEABLE_BASE_URL = "https://teable.example";
    process.env.TEABLE_API_KEY = "test-token";
    process.env.TEABLE_MESSAGES_TABLE_ID = "tblMessages";
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = originalEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("maps network failures to 502 and retries GET requests once", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(new TeableClient().listRecords("messages")).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers when the GET retry succeeds", async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(jsonResponse({ records: [{ id: "msg-1", fields: {} }] }));

    const records = await new TeableClient().listRecords("messages");

    expect(records).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps abort/timeout failures to 504", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation timed out.", "TimeoutError"));

    await expect(new TeableClient().listRecords("messages")).rejects.toMatchObject({ status: 504 });
  });

  it("does not retry HTTP error statuses", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: "boom" }, 500));

    await expect(new TeableClient().listRecords("messages")).rejects.toMatchObject({ status: 500 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries writes", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    await expect(new TeableClient().createRecord("messages", { text: "hi" })).rejects.toMatchObject({ status: 502 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
