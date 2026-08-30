import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

/**
 * Contratos das melhorias de UX da auditoria (2026-08-30): auto-scroll do
 * chat, erro de TTS visível com fallback de texto e confirmação ao finalizar.
 */
describe("chat ux contracts", () => {
  it("auto-scrolls the chat to the newest content, respecting manual scroll-up", () => {
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("const chatEndRef = useRef<HTMLDivElement | null>(null);");
    expect(chat).toContain('<div ref={chatEndRef} aria-hidden="true" />');
    expect(chat).toContain("scrollIntoView({ behavior, block: \"end\" })");
    // Abertura/retomada: scroll instantâneo para a última mensagem.
    expect(chat).toContain('scrollToChatEnd("auto")');
    // Novo conteúdo: só acompanha o fim se o usuário não subiu para ler.
    expect(chat).toContain("nearChatEndRef.current");
    expect(chat).toMatch(/\}, \[messages\.length, isSending, error, scrollToChatEnd\]\)/);
  });

  it("asks for confirmation before finalizing the conversation", () => {
    const chat = read("components/ChatConversation.tsx");
    expect(chat).toContain("const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = useState(false);");
    // O botão da tela só abre o diálogo; a ação final acontece na confirmação.
    expect(chat).toContain('onClick={() => setIsFinalizeDialogOpen(true)}');
    expect(chat).toContain("Finalizar e ver o resumo?");
    expect(chat).toContain("void finishConversation()");
  });

  it("makes TTS failure visible on the player buttons", () => {
    for (const file of ["components/MessageWordPlayer.tsx", "components/MessageAudioPlayer.tsx"]) {
      const player = read(file);
      expect(player).toContain('status === "error" ? "voice-icon-button audio-error" : "voice-icon-button"');
    }
    const css = read("app/globals.css");
    expect(css).toContain(".voice-icon-button.audio-error");
    expect(css).toContain(".chat-audio-error-note");
  });

  it("falls back to readable text when the player errors, even with transcript off", () => {
    const wordPlayer = read("components/MessageWordPlayer.tsx");
    expect(wordPlayer).toContain("showTranscript || status === \"error\"");
    expect(wordPlayer).toContain("Áudio indisponível agora — leia a mensagem acima.");
    const audioPlayer = read("components/MessageAudioPlayer.tsx");
    expect(audioPlayer).toContain("showTranscript || status === \"error\"");
    expect(audioPlayer).toContain("Áudio indisponível agora — leia a mensagem acima.");
  });
});
