import { describe, expect, it } from "vitest";
import { getDailyNewCardsQuota } from "../../lib/learning/profile";

describe("getDailyNewCardsQuota", () => {
  it("defaults to 10 when the field is missing or invalid", () => {
    expect(getDailyNewCardsQuota({ id: "u1", fields: {} })).toBe(10);
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: Number("x") } })).toBe(10);
  });

  it("clamps to the supported range", () => {
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: 0 } })).toBe(0);
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: 25 } })).toBe(25);
    expect(getDailyNewCardsQuota({ id: "u1", fields: { daily_new_cards_quota: 500 } })).toBe(50);
  });
});
