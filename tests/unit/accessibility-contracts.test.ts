import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("accessibility contracts", () => {
  it("keeps browser zoom enabled and provides a skip link", () => {
    expect(read("app/layout.tsx")).not.toContain("maximumScale");
    expect(read("components/AppShell.tsx")).toContain("Pular para o conteúdo");
    expect(read("components/AppShell.tsx")).toContain('id="main-content"');
  });

  it("exposes current navigation state and arbitrary pill semantics", () => {
    expect(read("components/BottomNav.tsx")).toContain("aria-current");
    expect(read("components/Pill.tsx")).toContain("...props");
  });

  it("provides keyboard focus and reduced-motion behavior", () => {
    const css = read("app/globals.css");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain("--primary: #217a38");
  });

  it("keeps dialogs keyboard-bound and isolates their background", () => {
    const dialog = read("components/ModalDialog.tsx");
    expect(dialog).toContain('event.key === "Escape"');
    expect(dialog).toContain('event.key !== "Tab"');
    expect(dialog).toContain("item.element.inert = true");
    expect(dialog).toContain("previousFocus?.focus()");
    expect(dialog).toContain('aria-modal="true"');
  });

  it("offers an accessible Portuguese translation on every chat message", () => {
    const chat = read("components/ChatConversation.tsx");
    const translation = read("components/TranslationButton.tsx");
    expect(chat.match(/<TranslationButton/g)).toHaveLength(2);
    expect(translation).toContain('aria-expanded=');
    expect(translation).toContain('aria-live="polite"');
    expect(translation).toContain('lang="pt-BR"');
  });
});
