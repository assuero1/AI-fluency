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

  it("exposes the new-words practice from the bottom nav", () => {
    const bottomNav = read("components/BottomNav.tsx");
    expect(bottomNav).toContain('href: "/palavras/novas"');
    expect(bottomNav).toContain('label: "Novas"');
    expect(read("app/palavras/page.tsx")).not.toContain("/palavras/novas");
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

  it("keeps SVG loading indicators centered and continuously animatable", () => {
    const css = read("app/globals.css");
    expect(css).toContain("transform-box: fill-box");
    expect(css).toContain("transform-origin: center");
    expect(css).toContain("animation: spin 0.9s linear infinite");
  });

  it("keeps status spinners moving when reduced motion is enabled", () => {
    const css = read("app/globals.css");
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*\.spin\s*\{[\s\S]*animation-duration: 0\.9s !important;[\s\S]*animation-iteration-count: infinite !important;/);
  });

  it("applies the v2 calm-surface contract (chunk only on primary CTA)", () => {
    const css = read("app/globals.css");
    expect(css).toContain("box-shadow: var(--shadow-cta), inset 0 1px 0 rgba(255, 255, 255, .25)");
    expect(css).toContain("transform: translateY(2px)");
    expect(css).toContain("box-shadow: var(--shadow-card)");
    expect(css).toContain("transition:\n    transform var(--motion-press) var(--ease-out)");
  });

  it("renders a mascot loading scene in the chat instead of static text", () => {
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("<LoadingScene");
    expect(chat).toContain('moment="think"');
  });

  it("provides mascot-based route loading screens", () => {
    expect(read("app/palavras/loading.tsx")).toContain("<LoadingScene");
    expect(read("app/progresso/loading.tsx")).toContain("<LoadingScene");
    expect(read("app/calendario/loading.tsx")).toContain("<LoadingScene");
    expect(read("app/loading.tsx")).toContain("<LoadingScene");
  });

  it("animates the audio wave while playing and the mic halo while listening", () => {
    const voice = read("components/VoiceButton.tsx");
    expect(voice).toContain("wave playing");
    expect(voice).not.toContain("#217a38");
    const css = read("app/globals.css");
    expect(css).toContain(".wave.playing span");
    expect(css).toContain("animation: wave-eq");
    expect(css).toContain(".mic-button.listening");
    expect(css).toContain("animation: pulse-halo");
  });

  it("adds chunky micro-interactions", () => {
    const css = read("app/globals.css");
    expect(css).toContain(".chat-row { animation: pop-in");
    expect(css).toContain("lucide-flame");
    expect(css).toContain("animation: flame-pulse");
    expect(css).toContain(".flashcard-card-inner");
    expect(css).toContain("transition: transform 280ms var(--ease-inout)");
  });

  it("documents the new token system", () => {
    const doc = read("docs/DESIGN_TOKENS.md");
    expect(doc).toContain("--brand: #58cc02");
    expect(doc).toContain("--section");
    expect(doc).toContain("Nunito");
  });
});
