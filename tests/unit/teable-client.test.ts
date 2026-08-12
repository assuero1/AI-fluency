import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/teable/config", () => ({
  getTeableConfig: () => ({
    baseUrl: "https://teable.test",
    apiKey: "token",
    tableIds: { words: "tbl_words" }
  })
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(records: Array<{ id: string; fields: Record<string, unknown> }>) {
  return {
    ok: true,
    headers: { get: (name: string) => (name === "content-type" ? "application/json" : null) },
    json: async () => ({ records })
  };
}

describe("listRecordsWhereAll", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("sends a conjunction filter with every field", async () => {
    fetchMock.mockResolvedValue(jsonResponse([{ id: "rec1", fields: { user_id: "u1", language_profile_id: "p1" } }]));
    const { TeableClient } = await import("../../lib/teable/client");
    const client = new TeableClient();

    const records = await client.listRecordsWhereAll("words", [
      { field: "user_id", value: "u1" },
      { field: "language_profile_id", value: "p1" }
    ]);

    expect(records).toHaveLength(1);
    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
    expect(url).toContain('"conjunction":"and"');
    expect(url).toContain('"fieldId":"language_profile_id"');
  });

  it("falls back to client-side filtering when the server ignores the filter", async () => {
    // Servidor ignora o filtro e devolve linhas de outro usuário (comportamento
    // do Teable self-hosted v1.10.x); o client deve filtrar no lado de cá.
    fetchMock.mockResolvedValue(jsonResponse([
      { id: "rec1", fields: { user_id: "u1", language_profile_id: "p1" } },
      { id: "rec2", fields: { user_id: "u2", language_profile_id: "p2" } }
    ]));
    const { TeableClient } = await import("../../lib/teable/client");
    const client = new TeableClient();

    const records = await client.listRecordsWhereAll("words", [
      { field: "user_id", value: "u1" },
      { field: "language_profile_id", value: "p1" }
    ]);

    expect(records.map((record) => record.id)).toEqual(["rec1"]);
  });
});
