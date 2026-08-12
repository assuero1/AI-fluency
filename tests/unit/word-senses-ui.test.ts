import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("word senses UI contracts", () => {
  it("renders the senses section on the word detail page with the detail senses", () => {
    const page = read("app/palavras/[wordId]/page.tsx");
    expect(page).toContain("<WordSensesSection");
    expect(page).toContain("senses={data.senses}");
    expect(page).toContain("wordId={word.id}");
  });

  it("lists every sense with state pill, streak/lapses and example in a server component", () => {
    const section = read("components/WordSensesSection.tsx");
    expect(section).not.toContain('"use client"');
    expect(section).toContain("Significados");
    expect(section).toContain("senses.map");
    expect(section).toContain("<Pill");
    expect(section).toContain("sense.needsReview");
    expect(section).toContain("sense.reviewState");
    expect(section).toContain("sense.reviewStreak");
    expect(section).toContain("sense.lapseCount");
    expect(section).toContain("sense.exampleSentence");
    expect(section).toContain("sense.isPrimary");
    expect(section).toContain("<AddSenseForm");
  });

  it("keeps an accessible add-sense form as a client component posting to the senses route", () => {
    const form = read("components/AddSenseForm.tsx");
    expect(form).toContain('"use client"');
    expect(form).toContain("Adicionar significado");
    expect(form).toContain("htmlFor=");
    expect(form).toContain("id=");
    expect(form).toContain("/api/words/");
    expect(form).toContain("/senses");
    expect(form).toContain("router.refresh()");
    expect(form).toContain('role="alert"');
    // Focus management: the translation input is focused when the form opens.
    expect(form).toContain(".focus()");
  });
});
