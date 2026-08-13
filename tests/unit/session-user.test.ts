import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const listRecordsWhereAll = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getRequestSupabaseClient: vi.fn(async () => ({ auth: { getUser } }))
}));
vi.mock("@/lib/teable/client", () => ({
  getTeableClient: () => ({ listRecordsWhereAll }),
  safeUpdateRecord: vi.fn(async (_t: string, _id: string, fields: unknown) => ({ id: "u1", fields })),
  TeableConfigError: class extends Error { status = 500 },
  TeableRequestError: class extends Error { status = 502 }
}));

describe("getSessionUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lança UnauthenticatedError (401) sem sessão", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { getSessionUser, UnauthenticatedError } = await import("@/lib/learning/profile");
    await expect(getSessionUser()).rejects.toBeInstanceOf(UnauthenticatedError);
  });

  it("lança UserLinkError (500) quando não há registro vinculado", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    listRecordsWhereAll.mockResolvedValue([]);
    const { getSessionUser, UserLinkError } = await import("@/lib/learning/profile");
    await expect(getSessionUser()).rejects.toBeInstanceOf(UserLinkError);
  });

  it("retorna o registro users vinculado ao auth_user_id", async () => {
    getUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    listRecordsWhereAll.mockResolvedValue([{ id: "u1", fields: { Name: "Camila" } }]);
    const { getSessionUser } = await import("@/lib/learning/profile");
    const user = await getSessionUser();
    expect(listRecordsWhereAll).toHaveBeenCalledWith("users", [{ field: "auth_user_id", value: "auth-1" }]);
    expect(user.id).toBe("u1");
  });
});
