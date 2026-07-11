import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";

function fixtureConversationId() {
  const { runId } = JSON.parse(fs.readFileSync(".qa-fixtures/e2e-run.json", "utf8")) as { runId: string };
  const manifest = JSON.parse(fs.readFileSync(`.qa-fixtures/${runId}.json`, "utf8")) as { records: Record<string, string[]> };
  return manifest.records.TEABLE_CONVERSATIONS_TABLE_ID[0];
}

function fixtureCompletedConversationId() {
  const { runId } = JSON.parse(fs.readFileSync(".qa-fixtures/e2e-run.json", "utf8")) as { runId: string };
  const manifest = JSON.parse(fs.readFileSync(`.qa-fixtures/${runId}.json`, "utf8")) as { records: Record<string, string[]> };
  return manifest.records.TEABLE_CONVERSATIONS_TABLE_ID[1];
}

function fixtureWordId() {
  const { runId } = JSON.parse(fs.readFileSync(".qa-fixtures/e2e-run.json", "utf8")) as { runId: string };
  const manifest = JSON.parse(fs.readFileSync(`.qa-fixtures/${runId}.json`, "utf8")) as { records: Record<string, string[]> };
  return manifest.records.TEABLE_WORDS_TABLE_ID[0];
}

function fixtureFeedbackDate() {
  return new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function fixtureFeedbackHeading() {
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${fixtureFeedbackDate()}T12:00:00Z`));
}

async function gotoAllowingServiceWorkerReload(page: Page, path: string) {
  try {
    await page.goto(path);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("net::ERR_ABORTED")) throw error;
  }
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/voice/synthesize", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA="
      })
    });
  });
});

test("mobile flashcard training completes a frozen deck once", async ({ page }) => {
  const completionBodies: Array<{ clientCompletionId?: string; answers?: unknown[] }> = [];
  await page.route("**/api/practice/flashcards", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, activeSession: null }) });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        sessionId: "session-e2e",
        languageCode: "es",
        languageName: "Espanhol",
        cards: [
          { id: "card-a", sessionId: "session-e2e", type: "target_to_native", targetWordId: "word-a", supportingWordIds: [], prompt: "hola", expectedAnswer: "olá", acceptedAnswers: [], translation: "olá", difficulty: 1 },
          { id: "card-b", sessionId: "session-e2e", type: "native_to_target", targetWordId: "word-b", supportingWordIds: [], prompt: "bom dia", expectedAnswer: "buen día", acceptedAnswers: [], translation: "bom dia", difficulty: 2 }
        ]
      })
    });
  });
  await page.route("**/api/practice/flashcards/attempt", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, attempt: { ...body, matchResult: body.forgot ? "incorrect" : "exact", suggestedRating: body.forgot ? "forgot" : "easy" } }) });
  });
  await page.route("**/api/practice/flashcards/complete", async (route) => {
    completionBodies.push(route.request().postDataJSON() as { clientCompletionId?: string; answers?: unknown[] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, score: 100, correctCards: 2, wrongCards: 0, totalCards: 2, reviewedWords: 2, uniqueCardCount: 2, presentationCount: 3, firstAttemptCorrect: 1, recoveredCards: 1 }) });
  });

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: /Montar treino/ }).click();
  await expect(page.getByText("hola", { exact: true })).toBeVisible();
  await expect(page.getByText("olá", { exact: true })).toHaveCount(0);
  const answer = page.getByRole("textbox", { name: "Resposta esperada em português" });
  await expect(answer).toBeFocused();
  await answer.fill("olá");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Resposta exata")).toBeVisible();
  await page.getByRole("button", { name: "Lembrei", exact: true }).click();
  await expect(page.getByText("bom dia", { exact: true })).toBeVisible();
  await expect(page.getByText("buen día", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Não lembro" }).click();
  await expect(page.getByText("buen día", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Não lembrei", exact: true }).click();
  await expect(page.getByText("bom dia", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Resposta esperada em Espanhol" }).fill("buen día");
  await page.getByRole("button", { name: "Responder" }).click();
  await page.getByRole("button", { name: "Lembrei", exact: true }).click();

  await expect(page.getByRole("heading", { name: "100% de acerto" })).toBeVisible();
  expect(completionBodies).toHaveLength(1);
  expect(completionBodies[0].clientCompletionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(completionBodies[0].answers).toHaveLength(3);
  expect(completionBodies[0].answers?.[0]).toMatchObject({ presentationNumber: 1, userAnswer: "olá", matchResult: "exact", rating: "good", forgot: false });
  expect(completionBodies[0].answers?.[1]).toMatchObject({ presentationNumber: 1, userAnswer: "", matchResult: "incorrect", rating: "forgot", forgot: true });
  expect(completionBodies[0].answers?.[2]).toMatchObject({ presentationNumber: 2, rating: "good" });
});

test("flashcard speech fills an editable attempt and never submits automatically", async ({ page }) => {
  await page.addInitScript(() => {
    class MockRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { (window as unknown as { __flashcardRecognition: MockRecognition }).__flashcardRecognition = this; }
      start() {}
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: MockRecognition });
  });
  await page.route("**/api/practice/flashcards", async (route) => route.fulfill({
    status: 201,
    contentType: "application/json",
    body: JSON.stringify(route.request().method() === "GET" ? { ok: true, activeSession: null } : { ok: true, sessionId: "speech-session", languageCode: "es", languageName: "Espanhol", cards: [
      { id: "speech-card", sessionId: "speech-session", type: "native_to_target", targetWordId: "word-a", supportingWordIds: [], prompt: "olá", expectedAnswer: "hola", acceptedAnswers: [], translation: "olá", difficulty: 2 }
    ] })
  }));

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: /Montar treino/ }).click();
  await page.getByRole("button", { name: "Falar resposta" }).click();
  await page.evaluate(() => {
    const recognition = (window as unknown as { __flashcardRecognition: { lang: string; onresult: ((event: unknown) => void) | null } }).__flashcardRecognition;
    if (recognition.lang !== "es") throw new Error(`Unexpected recognition language: ${recognition.lang}`);
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: "ola" } }] });
  });
  const input = page.getByRole("textbox", { name: "Resposta esperada em Espanhol" });
  await expect(input).toHaveValue("ola");
  await expect(page.getByText("Resposta esperada", { exact: true })).toHaveCount(0);
  await input.fill("hola");
  await page.getByRole("button", { name: "Responder" }).click();
  await expect(page.getByText("Resposta exata")).toBeVisible();
});

test("listening cards keep the text hidden until the learner requests audio", async ({ page }) => {
  let audioRequests = 0;
  await page.route("**/api/voice/synthesize", async (route) => {
    audioRequests += 1;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, audioUrl: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" }) });
  });
  await page.route("**/api/practice/flashcards", async (route) => route.fulfill({
    status: route.request().method() === "GET" ? 200 : 201,
    contentType: "application/json",
    body: JSON.stringify(route.request().method() === "GET" ? { ok: true, activeSession: null } : { ok: true, sessionId: "listening-session", languageCode: "es", languageName: "Espanhol", cards: [
      { id: "listening-card", sessionId: "listening-session", type: "listening", targetWordId: "word-a", supportingWordIds: [], prompt: "", expectedAnswer: "olá", acceptedAnswers: [], translation: "olá", audioText: "hola", difficulty: 3 }
    ] })
  }));

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: /Montar treino/ }).click();
  await expect(page.getByLabel("Card de escuta")).toBeVisible();
  await expect(page.getByText("hola", { exact: true })).toHaveCount(0);
  expect(audioRequests).toBe(0);
  await page.getByRole("button", { name: "Ouvir áudio" }).click();
  await expect.poll(() => audioRequests).toBe(1);
});

test("active flashcard session can resume from persisted attempts", async ({ page }) => {
  const card = { id: "resume-card", sessionId: "resume-session", type: "native_to_target", targetWordId: "word-a", supportingWordIds: [], prompt: "olá", expectedAnswer: "hola", acceptedAnswers: [], translation: "olá", difficulty: 2 };
  await page.route("**/api/practice/flashcards", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, activeSession: { sessionId: "resume-session", cards: [card], attempts: [], queue: [{ cardId: card.id, presentationNumber: 1, dueAfterIndex: 0 }], currentItem: { cardId: card.id, presentationNumber: 1, dueAfterIndex: 0 }, languageCode: "es", languageName: "Espanhol", adapted: false } })
  }));

  await page.goto("/palavras/treino");
  await expect(page.getByText("Treino em andamento")).toBeVisible();
  await page.getByRole("button", { name: "Continuar treino" }).click();
  await expect(page.getByText("olá", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Resposta esperada em Espanhol" })).toBeFocused();
});

test("mobile learner navigation keeps the standard bottom menu", async ({ page }) => {
  await page.goto("/");
  const languageSelector = page.getByRole("link", { name: "Trocar idioma de estudo. Idioma atual: Inglês" });
  await expect(languageSelector).toHaveAttribute("href", "/onboarding?mode=language");
  const navigation = page.getByRole("navigation", { name: "Navegação principal" });
  await expect(navigation.getByRole("link", { name: "Início" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Chat" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Palavras" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Calendário" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Perfil" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
});

test("home language selector opens a focused language switcher and returns safely", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Trocar idioma de estudo. Idioma atual: Inglês" }).click();
  await expect(page).toHaveURL(/\/onboarding\?mode=language$/);
  await expect(page.getByRole("heading", { name: "Escolha o idioma" })).toBeVisible();
  await page.getByRole("button", { name: "ES Espanhol Situações reais do dia a dia" }).click();
  await expect(page.getByRole("button", { name: "ES Espanhol Situações reais do dia a dia" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "Usar Espanhol" })).toBeVisible();
  await page.getByRole("link", { name: "Voltar para início" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("active chat confirms a topic change without losing the conversation surface", async ({ page }) => {
  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const change = page.getByRole("button", { name: "Mudar" });
  await expect(change).toBeVisible();
  await change.click();
  const dialog = page.getByRole("dialog", { name: "Mudar o tema da conversa?" });
  const topicInput = page.getByRole("textbox", { name: "Novo tema" });
  await expect(dialog).toBeVisible();
  await expect(topicInput).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("button", { name: "Cancelar" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(topicInput).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Mudar o tema da conversa?" })).toBeHidden();
  await expect(change).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Mensagem para a IA" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "Palavras" })).toBeVisible();
});

test("connection errors are announced and a retry can recover", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/settings/test-ai", async (route) => {
    attempts += 1;
    if (attempts === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "IA temporariamente indisponível." }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await page.goto("/settings/connections");
  const testAi = page.getByRole("button", { name: "Testar conexão: IA de conversa" });
  const testAiContainer = testAi.locator("..");
  await testAi.click();
  await expect(testAiContainer.getByRole("alert")).toHaveText("IA temporariamente indisponível.");
  await testAi.click();
  await expect(testAiContainer.getByRole("status")).toHaveText("Conexão validada.");
});

test("native speech keeps typed text, announces its language, and can stop safely", async ({ page }) => {
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = "";
      interimResults = false;
      continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      constructor() {
        (window as unknown as { __qaRecognition: MockSpeechRecognition }).__qaRecognition = this;
      }
      start() {}
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    Object.defineProperty(window, "SpeechRecognition", { configurable: true, value: MockSpeechRecognition });
    Object.defineProperty(window, "webkitSpeechRecognition", { configurable: true, value: MockSpeechRecognition });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const composer = page.getByRole("textbox", { name: "Mensagem para a IA" });
  expect(await composer.evaluate((element) => element.tagName)).toBe("TEXTAREA");
  await composer.fill("Texto existente");
  await page.getByRole("button", { name: "Falar mensagem" }).click();
  await expect(page.getByText("Ouvindo em inglês (Estados Unidos). Pressione o microfone novamente para parar.")).toBeVisible();
  expect(await page.evaluate(() => {
    const recognition = (window as unknown as { __qaRecognition?: { continuous?: boolean } }).__qaRecognition;
    return recognition?.continuous;
  })).toBe(true);

  await page.evaluate(() => {
    const recognition = (window as unknown as { __qaRecognition: { onresult: ((event: unknown) => void) | null } }).__qaRecognition;
    recognition.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: false, 0: { transcript: "hello world" } }]
    });
  });
  await expect(composer).toHaveValue("Texto existente hello world");
  await page.getByRole("button", { name: "Parar transcrição" }).click();
  await expect(composer).toHaveValue("Texto existente hello world.");
  await expect(page.getByText("Reconhecimento de voz: inglês (Estados Unidos).")).toBeVisible();
});

test("technical chat errors keep the draft and offer a successful retry", async ({ page }) => {
  let attempts = 0;
  await page.route("**/api/conversations/*/messages", async (route) => {
    attempts += 1;
    const body = route.request().postDataJSON() as { text: string };
    if (attempts === 1) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "The string did not match the expected pattern" })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        userMessage: {
          id: "retried-user-message",
          fields: { conversation_id: fixtureConversationId(), role: "user", text: body.text, created_at: new Date().toISOString() }
        },
        assistantMessage: {
          id: "retried-assistant-message",
          fields: { conversation_id: fixtureConversationId(), role: "assistant", text: "That reminds me of a similar experience.", created_at: new Date().toISOString() }
        },
        corrections: [],
        words: []
      })
    });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const composer = page.getByRole("textbox", { name: "Mensagem para a IA" });
  await composer.fill("I enjoy learning this way");
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  const chatRecovery = page.locator(".chat-recovery");
  await expect(chatRecovery).toContainText("Sua mensagem foi preservada");
  await expect(chatRecovery).not.toContainText("expected pattern");
  await expect(composer).toHaveValue("I enjoy learning this way");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("That reminds me of a similar experience.")).toBeVisible();
  await expect(composer).toHaveValue("");
});

test("assistant and learner messages can be translated to Portuguese", async ({ page }) => {
  await page.route("**/api/voice/synthesize", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, audioUrl: "/mock-audio.mp3" }) });
  });
  await page.route("**/api/translate", async (route) => {
    const body = route.request().postDataJSON() as { text?: string };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, targetLanguage: "pt-BR", translation: `Tradução: ${body.text ?? ""}` })
    });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const assistantTranslate = page.getByRole("button", { name: "Traduzir" });
  await expect(assistantTranslate).toHaveCount(1);
  await assistantTranslate.click();
  await expect(page.getByText("Tradução: Let's practice with a short answer.", { exact: false })).toBeVisible();

  await page.goto(`/chat?conversationId=${fixtureCompletedConversationId()}`);
  const learnerTranslate = page.getByRole("button", { name: "Traduzir" });
  await expect(learnerTranslate).toHaveCount(1);
  await learnerTranslate.click();
  await expect(page.getByText("Tradução: Yesterday I have coffee.", { exact: false })).toBeVisible();
});

test("voice playback supports pause, resume, replay, and one active audio", async ({ page }) => {
  await page.addInitScript(() => {
    class MockAudio {
      currentTime = 0;
      src = "";
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      paused = true;
      playAttempts = 0;
      constructor(src: string) {
        this.src = src;
        const target = window as unknown as { __qaAudios?: MockAudio[] };
        target.__qaAudios = [...(target.__qaAudios ?? []), this];
      }
      async play() {
        this.playAttempts += 1;
        if (this.playAttempts === 1) throw new Error("Autoplay blocked after synthesis");
        this.paused = false;
      }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
      load() {}
    }
    (window as unknown as { Audio: typeof MockAudio }).Audio = MockAudio;
  });
  let synthesisLanguage = "";
  await page.route("**/api/voice/synthesize", async (route) => {
    const body = route.request().postDataJSON() as { languageCode?: string };
    synthesisLanguage = body.languageCode ?? "";
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, audioUrl: "/mock-audio.mp3" }) });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const audioButtons = page.locator(".audio-pill");
  expect(await audioButtons.count()).toBeGreaterThan(0);
  const play = audioButtons.first();
  await play.click();
  const ready = page.getByRole("button", { name: "Reproduzir áudio" }).first();
  await expect(ready).toBeVisible();
  expect(synthesisLanguage).toBe("en");
  await ready.click();
  const pause = page.getByRole("button", { name: "Pausar áudio" }).first();
  await expect(pause).toBeVisible();
  await pause.click();
  const resume = page.getByRole("button", { name: "Continuar áudio" }).first();
  await expect(resume).toBeVisible();
  await resume.click();
  await expect(page.getByRole("button", { name: "Pausar áudio" }).first()).toBeVisible();
  await page.evaluate(() => {
    const audios = (window as unknown as { __qaAudios: Array<{ onended: (() => void) | null }> }).__qaAudios;
    audios.at(-1)?.onended?.();
  });
  await expect(page.getByRole("button", { name: "Reproduzir áudio novamente" }).first()).toBeVisible();
});

test("completed chat stays read-only", async ({ page }) => {
  await page.goto(`/chat?conversationId=${fixtureCompletedConversationId()}`);
  await expect(page.getByText("Esta conversa foi finalizada e está disponível apenas para consulta.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Escreva ou fale sua mensagem..." })).toHaveCount(0);
});

test("summary never invents feedback and only renders persisted completed data", async ({ page }) => {
  await gotoAllowingServiceWorkerReload(page, "/resumo");
  await expect(page.getByRole("heading", { name: "Resumo indisponível" })).toBeVisible();
  await expect(page.getByText("10/10")).toHaveCount(0);

  await gotoAllowingServiceWorkerReload(page, `/resumo?conversationId=${fixtureConversationId()}`);
  await expect(page.getByRole("heading", { name: "Resumo indisponível" })).toBeVisible();
  await expect(page.getByText("Finalize esta conversa antes de abrir o resumo.")).toBeVisible();

  await gotoAllowingServiceWorkerReload(page, `/resumo?conversationId=${fixtureCompletedConversationId()}`);
  await expect(page.getByRole("heading", { name: "Conversa finalizada" })).toBeVisible();
  await expect(page.getByText("8/10")).toBeVisible();
  await expect(page.getByText("Muito bem, QA User", { exact: false })).toBeVisible();
  await expect(page.getByText("QA fixture strength")).toBeVisible();
});

test("main learner screens render with the standard navigation", async ({ page }) => {
  for (const [path, heading] of [["/palavras", "Suas palavras"], ["/calendario", "Calendário"], ["/progresso", "Progresso"], ["/perfil", "Perfil"]] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
  }
});

test("offline screen is honest about unsaved messages", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Você está sem conexão" })).toBeVisible();
  await expect(page.getByText("Reconecte para continuar. Mensagens não enviadas não são salvas offline.")).toBeVisible();
  await expect(page.getByRole("link", { name: "Tentar novamente" })).toHaveAttribute("href", "/");
});

test("release visual matrix has no horizontal overflow or clipped navigation", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const surfaces = [
    { name: "home", path: "/", heading: "Olá," },
    { name: "onboarding", path: "/onboarding?mode=language", heading: "Escolha o idioma" },
    { name: "chat", path: `/chat?conversationId=${fixtureConversationId()}`, heading: "Conversa" },
    { name: "summary", path: `/resumo?conversationId=${fixtureCompletedConversationId()}`, heading: "Conversa finalizada" },
    { name: "words", path: "/palavras", heading: "Suas palavras" },
    { name: "word-detail", path: `/palavras/${fixtureWordId()}`, heading: "fixture" },
    { name: "calendar", path: "/calendario", heading: "Calendário" },
    { name: "calendar-detail", path: `/calendario/${fixtureFeedbackDate()}`, heading: fixtureFeedbackHeading() },
    { name: "progress", path: "/progresso", heading: "Progresso" },
    { name: "profile", path: "/perfil", heading: "Perfil" },
    { name: "connections", path: "/settings/connections", heading: "IA, Teable e Kokoro" },
    { name: "offline", path: "/offline", heading: "Você está sem conexão" }
  ];
  const viewports = [
    { width: 320, height: 568 },
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 430, height: 932 }
  ];

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const surface of surfaces) {
      await page.goto(surface.path);
      await expect(page.getByRole("heading", { name: surface.heading, exact: false }).first()).toBeVisible();
      const layout = await page.evaluate(() => ({
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        clippedNavigation: Array.from(document.querySelectorAll<HTMLElement>(".nav-item"))
          .some((item) => item.scrollWidth > item.clientWidth + 1)
      }));
      expect.soft(layout.horizontalOverflow, `${surface.name} overflows at ${viewport.width}px`).toBe(false);
      expect.soft(layout.clippedNavigation, `${surface.name} clips navigation at ${viewport.width}px`).toBe(false);
      await testInfo.attach(`${surface.name}-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png"
      });
    }
  }
});
