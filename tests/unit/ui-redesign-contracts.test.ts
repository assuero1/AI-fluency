import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("chunky playful redesign contracts", () => {
  it("loads Nunito via next/font and applies it as the app font", () => {
    const layout = read("app/layout.tsx");
    expect(layout).toContain("next/font/google");
    expect(layout).toContain("Nunito");
    expect(layout).toContain("--font-nunito");
    expect(read("app/globals.css")).toContain("var(--font-nunito)");
  });

  it("uses the new brand color in the PWA theme", () => {
    expect(read("app/layout.tsx")).toContain('themeColor: "#58cc02"');
  });

  it("defines the multi-color section palette and fixes --border", () => {
    const css = read("app/globals.css");
    for (const token of [
      "--brand: #58cc02",
      "--chat: #1cb0f6",
      "--palavras: #a560ff",
      "--calendario: #ff9600",
      "--progresso: #ffc800",
      "--neutral: #52667a",
      "--danger: #ff4b4b",
      "--border: var(--line)",
      "--primary: var(--section)",
      "--primary-soft: var(--section-soft)"
    ]) {
      expect(css).toContain(token);
    }
    for (const cls of [".section-chat", ".section-palavras", ".section-calendario", ".section-progresso", ".section-neutral"]) {
      expect(css).toContain(cls);
    }
  });

  it("applies section classes through AppShell on every routed screen", () => {
    const shell = read("components/AppShell.tsx");
    expect(shell).toContain("section-");
    expect(read("app/chat/page.tsx")).toContain('section="chat"');
    expect(read("app/palavras/page.tsx")).toContain('section="palavras"');
    expect(read("app/palavras/treino/page.tsx")).toContain('section="palavras"');
    expect(read("app/calendario/page.tsx")).toContain('section="calendario"');
    expect(read("app/progresso/page.tsx")).toContain('section="progresso"');
    expect(read("app/perfil/page.tsx")).toContain('section="neutral"');
    expect(read("app/resumo/page.tsx")).toContain('section="chat"');
  });

  it("removes hardcoded brand greens from component JSX", () => {
    expect(read("components/HomeDashboard.tsx")).not.toContain('color="#2f9d4a"');
    expect(read("components/ChatConversation.tsx")).not.toContain('color="#2f9d4a"');
    expect(read("app/progresso/page.tsx")).not.toContain('color="#2f9d4a"');
  });

  it("defines the new animation keyframes", () => {
    const css = read("app/globals.css");
    for (const name of ["dot-bounce", "shimmer", "wave-eq", "pulse-halo", "pop-in", "bounce-in", "flame-pulse"]) {
      expect(css).toContain(`@keyframes ${name}`);
    }
  });

  it("applies chunky 3D buttons and card borders", () => {
    const css = read("app/globals.css");
    expect(css).toContain("box-shadow: 0 4px 0 var(--section-deep)");
    expect(css).toContain("transform: translateY(4px)");
    expect(css).toContain("box-shadow: 0 3px 0 rgba(31, 25, 16, .05)");
  });

  it("renders animated typing dots in the chat instead of static text", () => {
    expect(read("components/LoadingDots.tsx")).toContain('role="status"');
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("<LoadingDots");
    expect(chat).toContain('srText="A IA está preparando a próxima resposta..."');
    const css = read("app/globals.css");
    expect(css).toContain(".loading-dot");
    expect(css).toContain("animation: dot-bounce");
  });
});
