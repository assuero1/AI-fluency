import { describe, expect, it } from "vitest";
import { SOUND_CATALOG, SOUND_NAMES } from "@/lib/client/ui-sound";

describe("SOUND_CATALOG", () => {
  it("expõe exatamente os sons do catálogo", () => {
    expect([...SOUND_NAMES].sort()).toEqual([
      "achievement",
      "button",
      "combo_1",
      "combo_2",
      "combo_3",
      "combo_4",
      "combo_5",
      "complete",
      "correct",
      "goal",
      "neutral",
      "wrong"
    ]);
  });

  it("cada som tem notas e ganho dentro dos limites do app", () => {
    for (const name of SOUND_NAMES) {
      const sound = SOUND_CATALOG[name];
      expect(sound.notes.length, name).toBeGreaterThan(0);
      expect(sound.gain, name).toBeGreaterThan(0);
      expect(sound.gain, name).toBeLessThanOrEqual(0.14);
      for (const note of sound.notes) {
        expect(note.frequency, name).toBeGreaterThan(80);
        expect(note.frequency, name).toBeLessThan(2200);
        expect(note.startAt, name).toBeGreaterThanOrEqual(0);
        expect(note.duration, name).toBeGreaterThan(0);
      }
    }
  });
});
