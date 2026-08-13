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
  await page.route("**/api/practice/flashcards/preview", async (route) => {
    const body = route.request().postDataJSON() as { forgot?: boolean };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, match: body.forgot ? "incorrect" : "exact", inferredRating: body.forgot ? "forgot" : "good", forgotDays: 1, rememberedDays: 7 }) });
  });
  await page.route("**/api/practice/flashcards/attempt", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, attempt: { ...body, matchResult: body.forgot ? "incorrect" : "exact", rating: body.forgot ? "forgot" : body.remembered ? "good" : "hard" } }) });
  });
  await page.route("**/api/practice/flashcards/complete", async (route) => {
    completionBodies.push(route.request().postDataJSON() as { clientCompletionId?: string; answers?: unknown[] });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, score: 100, correctCards: 2, wrongCards: 0, totalCards: 2, reviewedWords: 2, uniqueCardCount: 2, presentationCount: 3, firstAttemptCorrect: 1, recoveredCards: 1, productionAccuracy: 50, listeningAccuracy: null }) });
  });

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: "Sessão custom" }).click();
  await page.getByRole("button", { name: /Montar treino/ }).click();
  await expect(page.getByText("hola", { exact: true })).toBeVisible();
  // Legacy cards without targetSenseId show no sense indicator.
  await expect(page.getByText(/significado \d+ de \d+/)).toHaveCount(0);
  await expect(page.getByText("olá", { exact: true })).toHaveCount(0);
  const answer = page.getByRole("textbox", { name: "Resposta esperada em português" });
  await expect(answer).toBeFocused();
  await answer.fill("olá");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Resposta exata")).toBeVisible();
  await expect(page.getByText("→ 7 dias")).toBeVisible();
  await expect(page.getByText("→ 1 dia")).toBeVisible();
  await page.getByRole("button", { name: /^Lembrei/ }).click();
  await expect(page.getByText("bom dia", { exact: true })).toBeVisible();
  await expect(page.getByText("buen día", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Não lembro" }).click();
  await expect(page.getByText("buen día", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /^Não lembrei/ }).click();
  await expect(page.getByText("bom dia", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Resposta esperada em Espanhol" }).fill("buen día");
  await page.getByRole("button", { name: "Responder" }).click();
  await page.getByRole("button", { name: /^Lembrei/ }).click();

  await expect(page.getByRole("heading", { name: "100% de acerto" })).toBeVisible();
  await expect(page.getByText("Produção")).toBeVisible();
  await expect(page.getByText("50%")).toBeVisible();
  expect(completionBodies).toHaveLength(1);
  expect(completionBodies[0].clientCompletionId).toMatch(/^[0-9a-f-]{36}$/);
  expect(completionBodies[0].answers).toHaveLength(3);
  expect(completionBodies[0].answers?.[0]).toMatchObject({ presentationNumber: 1, userAnswer: "olá", matchResult: "exact", rating: "good", forgot: false });
  expect(completionBodies[0].answers?.[1]).toMatchObject({ presentationNumber: 1, userAnswer: "", matchResult: "incorrect", rating: "forgot", forgot: true });
  expect(completionBodies[0].answers?.[2]).toMatchObject({ presentationNumber: 2, rating: "good" });
});

test("sense-targeted flashcard presents the exercised meaning and completes", async ({ page }) => {
  const attemptBodies: Array<Record<string, unknown>> = [];
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
        sessionId: "session-sense",
        languageCode: "es",
        languageName: "Espanhol",
        cards: [
          { id: "card-sense", sessionId: "session-sense", type: "native_to_target", targetWordId: "word-banco", targetSenseId: "sense-bank", senseOrder: 2, senseCount: 3, supportingWordIds: [], prompt: "banco (instituição)", expectedAnswer: "banco", acceptedAnswers: [], translation: "banco (instituição)", difficulty: 2 }
        ]
      })
    });
  });
  await page.route("**/api/practice/flashcards/preview", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, match: "exact", inferredRating: "good", forgotDays: 1, rememberedDays: 7 }) });
  });
  await page.route("**/api/practice/flashcards/attempt", async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    attemptBodies.push(body);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, attempt: { ...body, matchResult: "exact", rating: "good" } }) });
  });
  await page.route("**/api/practice/flashcards/complete", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, score: 100, correctCards: 1, wrongCards: 0, totalCards: 1, reviewedWords: 1, uniqueCardCount: 1, presentationCount: 1, firstAttemptCorrect: 1, recoveredCards: 0, productionAccuracy: 100, listeningAccuracy: null }) });
  });

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: "Sessão custom" }).click();
  await page.getByRole("button", { name: /Montar treino/ }).click();
  // The card presents the specific sense being exercised, not another meaning of the word.
  await expect(page.getByText("banco (instituição)", { exact: true })).toBeVisible();
  // Multi-sense cards show which meaning is being exercised.
  await expect(page.getByText("significado 2 de 3", { exact: true })).toBeVisible();
  const answer = page.getByRole("textbox", { name: "Resposta esperada em Espanhol" });
  await expect(answer).toBeFocused();
  await answer.fill("banco");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Resposta exata")).toBeVisible();
  await expect(page.getByText("→ 7 dias")).toBeVisible();
  await page.getByRole("button", { name: /^Lembrei/ }).click();

  await expect(page.getByRole("heading", { name: "100% de acerto" })).toBeVisible();
  expect(attemptBodies).toHaveLength(1);
  expect(attemptBodies[0]).toMatchObject({ cardId: "card-sense", presentationNumber: 1, userAnswer: "banco" });
});

test("daily review queue intro starts a daily session", async ({ page }) => {
  const createBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/practice/flashcards", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          activeSession: null,
          dailyQueue: { dueCount: 3, newCount: 2, sessionCardCount: 5, remainingCount: 0, newAvailable: 8, introducedToday: 0, quota: 10, estimatedMinutes: 1, difficultCount: 0 }
        })
      });
      return;
    }
    createBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        sessionId: "session-daily",
        languageCode: "es",
        languageName: "Espanhol",
        cards: [
          { id: "card-daily", sessionId: "session-daily", type: "target_to_native", targetWordId: "word-a", supportingWordIds: [], prompt: "hola", expectedAnswer: "olá", acceptedAnswers: [], translation: "olá", difficulty: 1 }
        ]
      })
    });
  });

  await page.goto("/palavras/treino");
  await expect(page.getByText(/3 revisões \+ 2 novas/)).toBeVisible();
  await page.getByRole("button", { name: "Começar revisão de hoje" }).click();
  await expect(page.getByText("hola", { exact: true })).toBeVisible();
  expect(createBodies).toHaveLength(1);
  expect(createBodies[0]).toEqual({ queueKind: "daily" });
});

test("listening card plays audio prompt and shows interval hints", async ({ page }) => {
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
        sessionId: "session-listen",
        languageCode: "es",
        languageName: "Espanhol",
        cards: [
          { id: "card-listen", sessionId: "session-listen", type: "listening", targetWordId: "word-l", supportingWordIds: [], prompt: "", expectedAnswer: "hola", acceptedAnswers: [], translation: "olá", audioText: "hola", difficulty: 3 }
        ]
      })
    });
  });
  await page.route("**/api/practice/flashcards/preview", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, match: "exact", inferredRating: "good", forgotDays: 1, rememberedDays: 7 }) });
  });

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: "Sessão custom" }).click();
  await page.getByRole("button", { name: /Montar treino/ }).click();
  await expect(page.getByLabel("Card de escuta")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvir áudio" })).toBeVisible();
  await page.getByRole("textbox", { name: "Resposta esperada em português" }).fill("olá");
  await page.getByRole("button", { name: "Responder" }).click();
  await expect(page.getByText("→ 7 dias")).toBeVisible();
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
  await page.route("**/api/practice/flashcards/preview", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, match: "exact", inferredRating: "good", forgotDays: 1, rememberedDays: 7 }) });
  });

  await page.goto("/palavras/treino");
  await page.getByRole("button", { name: "Sessão custom" }).click();
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
  await page.getByRole("button", { name: "Sessão custom" }).click();
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
  await expect(page.getByRole("button", { name: "Finalizar conversa" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Chamar professor" })).toBeVisible();
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

test("translation recovers from a transient server failure without a second click", async ({ page }) => {
  let requests = 0;
  await page.route("**/api/translate", async (route) => {
    requests += 1;
    if (requests === 1) {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Upstream service unreachable." }) });
      return;
    }
    const body = route.request().postDataJSON() as { text?: string };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, translation: `Tradução: ${body.text ?? ""}` }) });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const translate = page.getByRole("button", { name: "Traduzir" });
  await expect(translate).toHaveCount(1);
  await translate.click();
  await expect(page.getByText("Tradução: Let's practice with a short answer.", { exact: false })).toBeVisible();
  expect(requests).toBe(2);
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
  await page.route("**/api/voice/captioned", async (route) => {
    const body = route.request().postDataJSON() as { text?: string; languageCode?: string };
    synthesisLanguage = body.languageCode ?? "";
    const words = (body.text ?? "").split(/\s+/).filter(Boolean).map((word, index) => ({ word, start_time: index * 0.4, end_time: index * 0.4 + 0.3 }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, audioUrl: "/mock-audio.mp3", words }) });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const playButtons = page.getByRole("button", { name: "Ouvir mensagem" });
  await expect(playButtons.first()).toBeVisible();
  await playButtons.first().click();
  const retry = page.getByRole("button", { name: "Voz indisponível. Tentar novamente" }).first();
  await expect(retry).toBeVisible();
  expect(synthesisLanguage).toBe("en");
  await retry.click();
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
  await expect(page.getByRole("button", { name: "Ouvir novamente" }).first()).toBeVisible();
});

test("voice playback replays an ended message", async ({ page }) => {
  await page.addInitScript(() => {
    class MockAudio {
      currentTime = 0;
      src = "";
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      paused = true;
      constructor(src: string) {
        this.src = src;
        const target = window as unknown as { __qaReplayAudios?: MockAudio[] };
        target.__qaReplayAudios = [...(target.__qaReplayAudios ?? []), this];
      }
      async play() { this.paused = false; }
      pause() { this.paused = true; }
      removeAttribute() { this.src = ""; }
      load() {}
    }
    Object.defineProperty(window, "Audio", { configurable: true, value: MockAudio });
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
  });
  await page.route("**/api/voice/captioned", async (route) => {
    const body = route.request().postDataJSON() as { text?: string };
    const words = (body.text ?? "").split(/\s+/).filter(Boolean).map((word, index) => ({ word, start_time: index * 0.4, end_time: index * 0.4 + 0.3 }));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, audioUrl: "/mock-audio.mp3", words }) });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const playButtons = page.getByRole("button", { name: "Ouvir mensagem" });
  await expect(playButtons.first()).toBeVisible();
  await playButtons.first().click();
  await expect(page.getByRole("button", { name: "Pausar áudio" }).first()).toBeVisible();
  await page.evaluate(() => {
    const audios = (window as unknown as { __qaReplayAudios: Array<{ onended: (() => void) | null }> }).__qaReplayAudios;
    audios.at(-1)?.onended?.();
  });
  const replay = page.getByRole("button", { name: "Ouvir novamente" }).first();
  await expect(replay).toBeVisible();
  await replay.click();
  await expect(page.getByRole("button", { name: "Pausar áudio" }).first()).toBeVisible();
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

test("configuração de prática escolhe simulação e envia a meta", async ({ page }) => {
  const startBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/conversations/start", async (route) => {
    startBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, redirectTo: "/chat?conversationId=mock" })
    });
  });

  await page.goto("/");
  await page.getByRole("textbox", { name: "Tema para praticar" }).fill("Pedir café na padaria");
  await page.getByRole("button", { name: "Começar com este tema" }).click();
  const dialog = page.getByRole("dialog", { name: "Configurar prática" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("radio", { name: /Simulação/ }).click();
  await dialog.getByRole("checkbox", { name: "Definir meta de mensagens" }).check();
  await dialog.getByRole("spinbutton", { name: "Quantas mensagens você quer enviar?" }).fill("8");
  await dialog.getByRole("button", { name: "Começar prática" }).click();

  await expect.poll(() => startBodies).toHaveLength(1);
  expect(startBodies[0]).toMatchObject({
    title: "Pedir café na padaria",
    mode: "custom_topic",
    interactionMode: "simulation",
    targetUserMessageCount: 8
  });
});

test("configuração de prática conversa livre usa modo conversa sem simulação", async ({ page }) => {
  const startBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/conversations/start", async (route) => {
    startBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, redirectTo: "/chat?conversationId=mock" })
    });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Iniciar conversa livre" }).click();
  const dialog = page.getByRole("dialog", { name: "Configurar prática" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Conversa livre usa o modo conversa.")).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /Simulação/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "Começar prática" }).click();

  await expect.poll(() => startBodies).toHaveLength(1);
  expect(startBodies[0]).toMatchObject({
    mode: "free_conversation",
    interactionMode: "conversation",
    targetUserMessageCount: 0
  });
});

test("meta de mensagens avança, reverte em falha e retry não duplica", async ({ page }) => {
  let attempts = 0;
  const clientRequestIds: string[] = [];
  await page.route("**/api/conversations/*/messages", async (route) => {
    attempts += 1;
    const body = route.request().postDataJSON() as { text: string; clientRequestId: string };
    clientRequestIds.push(body.clientRequestId);
    if (attempts === 2) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "failed to fetch" }) });
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        userMessage: {
          id: `goal-user-${attempts}`,
          fields: { conversation_id: fixtureConversationId(), role: "user", text: body.text, channel: "practice", created_at: new Date().toISOString() }
        },
        assistantMessage: {
          id: `goal-assistant-${attempts}`,
          fields: { conversation_id: fixtureConversationId(), role: "assistant", text: `Resposta ${attempts}`, channel: "practice", created_at: new Date().toISOString() }
        },
        corrections: [],
        words: []
      })
    });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  await expect(page.getByText("0 de 2 mensagens")).toBeVisible();
  const composer = page.getByRole("textbox", { name: "Mensagem para a IA" });
  await composer.fill("Primeira mensagem");
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(page.getByText("Faltam 1.")).toBeVisible();
  await composer.fill("Segunda mensagem");
  await page.getByRole("button", { name: "Enviar mensagem" }).click();
  await expect(page.getByText("Faltam 1.")).toBeVisible();
  await expect(composer).toHaveValue("Segunda mensagem");
  await page.getByRole("button", { name: "Tentar novamente" }).click();
  await expect(page.getByText("Meta concluída!")).toBeVisible();
  await expect(page.locator(".bubble.user")).toHaveCount(2);
  await expect(composer).toBeEnabled();
  expect(clientRequestIds).toHaveLength(3);
  expect(clientRequestIds[1]).toBe(clientRequestIds[2]);
});

test("professor de IA fica isolado, persiste e não altera a meta", async ({ page }) => {
  const stored: Array<Record<string, unknown>> = [];
  await page.route("**/api/conversations/*/teacher/messages", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, messages: stored }) });
      return;
    }
    const body = route.request().postDataJSON() as { text: string };
    const userMessage = {
      id: `teacher-user-${stored.length + 1}`,
      fields: { conversation_id: fixtureConversationId(), role: "user", text: body.text, channel: "teacher", created_at: new Date().toISOString() }
    };
    const assistantMessage = {
      id: `teacher-ai-${stored.length + 1}`,
      fields: { conversation_id: fixtureConversationId(), role: "assistant", text: "Você pode dizer: 'May I have a coffee?'", channel: "teacher", created_at: new Date().toISOString() }
    };
    stored.push(userMessage, assistantMessage);
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, userMessage, assistantMessage }) });
  });

  await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  const teacherButton = page.getByRole("button", { name: "Chamar professor" });
  await expect(teacherButton).toBeVisible();
  await teacherButton.click();
  const panel = page.getByRole("dialog", { name: "Professor de IA" });
  await expect(panel).toBeVisible();
  const composer = panel.getByRole("textbox", { name: "Pergunta para o professor" });
  await expect(composer).toBeFocused();
  const composerMetrics = await panel.locator("form.composer").evaluate((form) => {
    const input = form.querySelector<HTMLTextAreaElement>(".composer-input");
    return { formWidth: form.getBoundingClientRect().width, inputWidth: input?.getBoundingClientRect().width ?? 0 };
  });
  expect(composerMetrics.inputWidth).toBeGreaterThan(composerMetrics.formWidth * 0.6);
  await expect(panel.getByText("Este chat não conta na sua meta e não altera a conversa principal.")).toBeVisible();
  await composer.fill("Como peço um café?");
  await panel.getByRole("button", { name: "Enviar pergunta ao professor" }).click();
  await expect(panel.getByText("Como peço um café?")).toBeVisible();
  await expect(panel.locator(".bubble.teacher-ai", { hasText: "Você pode dizer: 'May I have a coffee?'" })).toBeVisible();
  await expect(page.getByText("0 de 2 mensagens")).toBeVisible();
  await panel.getByRole("button", { name: "Fechar professor" }).click();
  await expect(teacherButton).toBeFocused();
  await expect(page.getByText("Como peço um café?")).toHaveCount(0);
  await teacherButton.click();
  await expect(panel.getByText("Como peço um café?")).toBeVisible();
  await expect(panel.locator(".bubble.teacher-ai", { hasText: "Você pode dizer: 'May I have a coffee?'" })).toBeVisible();
});

test("professor de IA disponível em conversa concluída", async ({ page }) => {
  const postBodies: Array<Record<string, unknown>> = [];
  await page.route("**/api/conversations/*/teacher/messages", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, messages: [] }) });
      return;
    }
    const body = route.request().postDataJSON() as { text: string };
    postBodies.push(body);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        userMessage: {
          id: "completed-teacher-user",
          fields: { conversation_id: fixtureCompletedConversationId(), role: "user", text: body.text, channel: "teacher", created_at: new Date().toISOString() }
        },
        assistantMessage: {
          id: "completed-teacher-ai",
          fields: { conversation_id: fixtureCompletedConversationId(), role: "assistant", text: "Resposta do professor.", channel: "teacher", created_at: new Date().toISOString() }
        }
      })
    });
  });

  await page.goto(`/chat?conversationId=${fixtureCompletedConversationId()}`);
  await expect(page.getByRole("textbox", { name: "Mensagem para a IA" })).toHaveCount(0);
  const teacherButton = page.getByRole("button", { name: "Chamar professor" });
  await expect(teacherButton).toBeVisible();
  await teacherButton.click();
  const panel = page.getByRole("dialog", { name: "Professor de IA" });
  await expect(panel).toBeVisible();
  const composer = panel.getByRole("textbox", { name: "Pergunta para o professor" });
  await composer.fill("Ainda posso perguntar?");
  await panel.getByRole("button", { name: "Enviar pergunta ao professor" }).click();
  await expect(panel.locator(".bubble.teacher-ai", { hasText: "Resposta do professor." })).toBeVisible();
  expect(postBodies).toHaveLength(1);
});

test("offline screen is honest about unsaved messages", async ({ page }) => {
  await page.goto("/offline");
  await expect(page.getByRole("heading", { name: "Você está sem conexão" })).toBeVisible();
  await expect(page.getByText("Reconecte para continuar. Mensagens não enviadas não são salvas offline.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar novamente" })).toBeVisible();
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
          .some((item) => item.scrollWidth > item.clientWidth + 1),
        overflowingElements: Array.from(document.querySelectorAll<HTMLElement>("body *"))
          .filter((item) => item.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
          .slice(0, 8)
          .map((item) => ({
            tag: item.tagName.toLowerCase(),
            className: item.className,
            text: item.textContent?.trim().slice(0, 80) ?? "",
            right: Math.round(item.getBoundingClientRect().right),
            width: Math.round(item.getBoundingClientRect().width)
          }))
      }));
      expect.soft(layout.horizontalOverflow, `${surface.name} overflows at ${viewport.width}px: ${JSON.stringify(layout.overflowingElements)}`).toBe(false);
      expect.soft(layout.clippedNavigation, `${surface.name} clips navigation at ${viewport.width}px`).toBe(false);
      await testInfo.attach(`${surface.name}-${viewport.width}x${viewport.height}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png"
      });
    }
  }
});
