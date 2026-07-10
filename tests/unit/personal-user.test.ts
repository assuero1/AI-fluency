import { describe, expect, it } from "vitest";
import {
  PersonalUserResolutionError,
  resolvePersonalUser,
  type UserFields
} from "../../lib/learning/profile";
import type { TeableRecord } from "../../lib/teable/client";

function user(id: string, name?: string): TeableRecord<UserFields> {
  return { id, fields: name ? { Name: name, created_at: "2026-07-10T10:00:00.000Z" } : {} };
}

describe("personal user resolution", () => {
  it("returns null for an empty personal base", () => {
    expect(resolvePersonalUser([])).toBeNull();
    expect(resolvePersonalUser([user("blank")])).toBeNull();
  });

  it("uses the only non-empty user when no explicit ID is required", () => {
    expect(resolvePersonalUser([user("blank"), user("personal", "Camila")])?.id).toBe("personal");
  });

  it("uses an explicit configured ID even when multiple users exist", () => {
    const users = [user("first", "First"), user("selected", "Selected")];
    expect(resolvePersonalUser(users, "selected")?.id).toBe("selected");
  });

  it("refuses to guess between multiple users", () => {
    expect(() => resolvePersonalUser([user("a", "A"), user("b", "B")])).toThrow(PersonalUserResolutionError);
  });

  it("fails clearly when the configured user does not exist", () => {
    expect(() => resolvePersonalUser([user("a", "A")], "missing")).toThrow(/AI_FLUENCY_USER_ID/);
  });
});
