import { describe, expect, it } from "vitest";
import { matchesLearningScope, matchesUserScope } from "../../lib/learning/scope";

describe("strict learning scope", () => {
  const scope = { userId: "user-a", profileId: "profile-en" };

  it("accepts only records with the exact user and language profile", () => {
    expect(matchesLearningScope({ user_id: "user-a", language_profile_id: "profile-en" }, scope)).toBe(true);
    expect(matchesLearningScope({ user_id: "user-a", language_profile_id: "profile-es" }, scope)).toBe(false);
    expect(matchesLearningScope({ user_id: "user-b", language_profile_id: "profile-en" }, scope)).toBe(false);
  });

  it("does not treat legacy unscoped records as universal", () => {
    expect(matchesLearningScope({ user_id: "user-a" }, scope)).toBe(false);
    expect(matchesLearningScope({ language_profile_id: "profile-en" }, scope)).toBe(false);
    expect(matchesLearningScope({}, scope)).toBe(false);
    expect(matchesLearningScope({ user_id: "user-a", language_profile_id: "profile-en" }, { userId: "user-a" })).toBe(false);
  });

  it("supports explicit user-only ownership checks", () => {
    expect(matchesUserScope({ user_id: "user-a" }, "user-a")).toBe(true);
    expect(matchesUserScope({}, "user-a")).toBe(false);
    expect(matchesUserScope({ user_id: "user-b" }, "user-a")).toBe(false);
  });
});
