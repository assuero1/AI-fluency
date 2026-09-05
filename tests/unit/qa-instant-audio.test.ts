import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(import.meta.dirname, "../..");
const readFile = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("QA: Instant Audio Playback & DeepInfra Chatterbox Streaming", () => {
  let cacheDir: string;

  beforeEach(() => {
    cacheDir = mkdtempSync(path.join(tmpdir(), "qa-audio-cache-"));
    vi.stubEnv("DEEPINFRA_API_KEY", "qa-deepinfra-token");
    vi.stubEnv("DEEPINFRA_BASE_URL", "https://api.deepinfra.test");
    vi.stubEnv("DEEPINFRA_CHATTERBOX_MODEL", "ResembleAI/chatterbox-multilingual");
    vi.stubEnv("DEEPINFRA_CHATTERBOX_OUTPUT_FORMAT", "mp3");
    vi.stubEnv("AUDIO_CACHE_DIR", cacheDir);
    vi.stubEnv("TTS_PROVIDER", "deepinfra");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    if (existsSync(cacheDir)) {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  describe("1. Warm síncrono & Cache Hit imediato", () => {
    it("garante que warmCaptionedMessage persiste o áudio no cache e chamada posterior resulta em cache: true", async () => {
      const sampleAudio = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04]);
      let fetchCount = 0;

      vi.stubGlobal("fetch", vi.fn(async () => {
        fetchCount += 1;
        return new Response(JSON.stringify({
          audio: sampleAudio.toString("base64"),
          words: [
            { word: "Hello", start: 0, end: 0.5 },
            { word: "world", start: 0.5, end: 1.0 }
          ]
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }));

      const { warmCaptionedMessage, prepareCaptionedSpeech } = await import("../../lib/kokoro/cache");

      // Simula a chegada de uma resposta da IA que aciona warmCaptionedMessage
      const messageText = "Hello world.";
      await warmCaptionedMessage(messageText, "en");

      // Deve ter chamado a API TTS exatamente 1 vez para gerar e gravar em disco
      expect(fetchCount).toBe(1);

      // Agora o usuário clica em PLAY no chat: chama prepareCaptionedSpeech
      const playbackResult = await prepareCaptionedSpeech(messageText, { languageCode: "en" });

      // O playbackResult DEVE vir direto do cache em disco instantaneamente!
      expect(playbackResult.cached).toBe(true);
      expect(playbackResult.audioUrl).toMatch(/^\/api\/voice\/[a-f0-9]{64}$/);
      expect(playbackResult.words).toHaveLength(2);
      expect(playbackResult.words[0].word).toBe("Hello");

      // NENHUMA nova requisição externa deve ter sido feita
      expect(fetchCount).toBe(1);
    });

    it("agenda warm após responder, sem bloquear o texto", () => {
      const routeContent = readFile("app/api/conversations/[conversationId]/messages/route.ts");
      expect(routeContent).toContain("after(() => warmCaptionedMessage(assistant.text, assistant.language_detected))");
      expect(routeContent).not.toContain("await warmCaptionedMessage");
    });
  });

  describe("2. DeepInfra Streaming de áudio", () => {
    it("streamDeepInfraSpeech consome stream binário sem bufferizar todo o corpo", async () => {
      const streamChunks = [
        new Uint8Array([0x52, 0x49]),
        new Uint8Array([0x46, 0x46]),
        new Uint8Array([0x01, 0x02])
      ];

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of streamChunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        }
      });

      vi.stubGlobal("fetch", vi.fn(async () => new Response(readable, {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      })));

      const { streamDeepInfraSpeech } = await import("../../lib/tts/deepinfra/client");
      const result = await streamDeepInfraSpeech("Quick stream test", { languageCode: "en" });

      expect(result.contentType).toBe("audio/mpeg");
      expect(result.outputFormat).toBe("mp3");

      const reader = result.audioStream.getReader();
      const chunksReceived: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunksReceived.push(value);
      }

      expect(chunksReceived).toHaveLength(3);
      expect(chunksReceived[0]).toEqual(streamChunks[0]);
      expect(chunksReceived[1]).toEqual(streamChunks[1]);
      expect(chunksReceived[2]).toEqual(streamChunks[2]);
    });

    it("streamPendingAudio utiliza o provider ativo com streamSpeech dinamicamente", async () => {
      const { streamPendingAudio } = await import("../../lib/kokoro/cache");
      const { createAudioId } = await import("../../lib/kokoro/cache");
      const { writeFile } = await import("node:fs/promises");

      const text = "Pending streaming audio test.";
      const audioId = createAudioId(text, "default", "mp3", 1, "deepinfra", "en");

      // Cria o arquivo de pending no disco
      const pendingData = {
        id: audioId,
        text,
        voice: "default",
        outputFormat: "mp3",
        speed: 1,
        languageCode: "en",
        expiresAt: Date.now() + 60_000
      };
      await writeFile(path.join(cacheDir, `${audioId}.pending.json`), JSON.stringify(pendingData));

      const rawAudio = new Uint8Array([0x01, 0x02, 0x03]);
      vi.stubGlobal("fetch", vi.fn(async () => new Response(rawAudio, {
        status: 200,
        headers: { "content-type": "audio/mpeg" }
      })));

      const streamResult = await streamPendingAudio(audioId);
      expect(streamResult).not.toBeNull();
      expect(streamResult?.contentType).toBe("audio/mpeg");
      expect(streamResult?.fileName).toBe(`${audioId}.mp3`);
    });
  });

  describe("3. Contratos de UI & UX de reprodução rápida", () => {
    it("contém estilos da animação audio-waveform-loader em globals.css", () => {
      const css = readFile("app/globals.css");
      expect(css).toContain(".audio-waveform-loader");
      expect(css).toContain(".audio-wave-bar");
      expect(css).toContain("@keyframes audioWavePulse");
    });

    it("MessageAudioPlayer utiliza audio-waveform-loader no estado loading", () => {
      const audioPlayer = readFile("components/MessageAudioPlayer.tsx");
      expect(audioPlayer).toContain('className="audio-waveform-loader"');
      expect(audioPlayer).toContain('className="audio-wave-bar"');
      expect(audioPlayer).not.toMatch(/status\s*===\s*"loading"\s*\?\s*\(\s*<Loader2/);
    });

    it("o modo palavra reutiliza o player progressivo em vez de gerar outro áudio", () => {
      expect(readFile("components/MessageWordPlayer.tsx")).toContain("<MessageAudioPlayer {...props} />");
    });
  });
});
