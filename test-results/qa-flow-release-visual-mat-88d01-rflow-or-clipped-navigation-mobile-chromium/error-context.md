# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: qa-flow.spec.ts >> release visual matrix has no horizontal overflow or clipped navigation
- Location: tests/e2e/qa-flow.spec.ts:463:5

# Error details

```
Error: words overflows at 320px

expect(received).toBe(expected) // Object.is equality

Expected: false
Received: true
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - link "Pular para o conteúdo" [ref=e2] [cursor=pointer]:
    - /url: "#main-content"
  - main [ref=e3]:
    - generic [ref=e5]:
      - img [ref=e6]
      - heading "Você está sem conexão" [level=1] [ref=e13]
      - paragraph [ref=e14]: Reconecte para continuar. Mensagens não enviadas não são salvas offline.
      - link "Tentar novamente" [ref=e15] [cursor=pointer]:
        - /url: /
  - alert [ref=e16]
```

# Test source

```ts
  397 |   await page.route("**/api/voice/synthesize", async (route) => {
  398 |     const body = route.request().postDataJSON() as { languageCode?: string };
  399 |     synthesisLanguage = body.languageCode ?? "";
  400 |     await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, audioUrl: "/mock-audio.mp3" }) });
  401 |   });
  402 | 
  403 |   await page.goto(`/chat?conversationId=${fixtureConversationId()}`);
  404 |   const audioButtons = page.locator(".audio-pill");
  405 |   expect(await audioButtons.count()).toBeGreaterThan(0);
  406 |   const play = audioButtons.first();
  407 |   await play.click();
  408 |   const ready = page.getByRole("button", { name: "Reproduzir áudio" }).first();
  409 |   await expect(ready).toBeVisible();
  410 |   expect(synthesisLanguage).toBe("en");
  411 |   await ready.click();
  412 |   const pause = page.getByRole("button", { name: "Pausar áudio" }).first();
  413 |   await expect(pause).toBeVisible();
  414 |   await pause.click();
  415 |   const resume = page.getByRole("button", { name: "Continuar áudio" }).first();
  416 |   await expect(resume).toBeVisible();
  417 |   await resume.click();
  418 |   await expect(page.getByRole("button", { name: "Pausar áudio" }).first()).toBeVisible();
  419 |   await page.evaluate(() => {
  420 |     const audios = (window as unknown as { __qaAudios: Array<{ onended: (() => void) | null }> }).__qaAudios;
  421 |     audios.at(-1)?.onended?.();
  422 |   });
  423 |   await expect(page.getByRole("button", { name: "Reproduzir áudio novamente" }).first()).toBeVisible();
  424 | });
  425 | 
  426 | test("completed chat stays read-only", async ({ page }) => {
  427 |   await page.goto(`/chat?conversationId=${fixtureCompletedConversationId()}`);
  428 |   await expect(page.getByText("Esta conversa foi finalizada e está disponível apenas para consulta.")).toBeVisible();
  429 |   await expect(page.getByRole("textbox", { name: "Escreva ou fale sua mensagem..." })).toHaveCount(0);
  430 | });
  431 | 
  432 | test("summary never invents feedback and only renders persisted completed data", async ({ page }) => {
  433 |   await gotoAllowingServiceWorkerReload(page, "/resumo");
  434 |   await expect(page.getByRole("heading", { name: "Resumo indisponível" })).toBeVisible();
  435 |   await expect(page.getByText("10/10")).toHaveCount(0);
  436 | 
  437 |   await gotoAllowingServiceWorkerReload(page, `/resumo?conversationId=${fixtureConversationId()}`);
  438 |   await expect(page.getByRole("heading", { name: "Resumo indisponível" })).toBeVisible();
  439 |   await expect(page.getByText("Finalize esta conversa antes de abrir o resumo.")).toBeVisible();
  440 | 
  441 |   await gotoAllowingServiceWorkerReload(page, `/resumo?conversationId=${fixtureCompletedConversationId()}`);
  442 |   await expect(page.getByRole("heading", { name: "Conversa finalizada" })).toBeVisible();
  443 |   await expect(page.getByText("8/10")).toBeVisible();
  444 |   await expect(page.getByText("Muito bem, QA User", { exact: false })).toBeVisible();
  445 |   await expect(page.getByText("QA fixture strength")).toBeVisible();
  446 | });
  447 | 
  448 | test("main learner screens render with the standard navigation", async ({ page }) => {
  449 |   for (const [path, heading] of [["/palavras", "Suas palavras"], ["/calendario", "Calendário"], ["/progresso", "Progresso"], ["/perfil", "Perfil"]] as const) {
  450 |     await page.goto(path);
  451 |     await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  452 |     await expect(page.getByRole("navigation", { name: "Navegação principal" })).toBeVisible();
  453 |   }
  454 | });
  455 | 
  456 | test("offline screen is honest about unsaved messages", async ({ page }) => {
  457 |   await page.goto("/offline");
  458 |   await expect(page.getByRole("heading", { name: "Você está sem conexão" })).toBeVisible();
  459 |   await expect(page.getByText("Reconecte para continuar. Mensagens não enviadas não são salvas offline.")).toBeVisible();
  460 |   await expect(page.getByRole("link", { name: "Tentar novamente" })).toHaveAttribute("href", "/");
  461 | });
  462 | 
  463 | test("release visual matrix has no horizontal overflow or clipped navigation", async ({ page }, testInfo) => {
  464 |   test.setTimeout(180_000);
  465 |   const surfaces = [
  466 |     { name: "home", path: "/", heading: "Olá," },
  467 |     { name: "onboarding", path: "/onboarding?mode=language", heading: "Escolha o idioma" },
  468 |     { name: "chat", path: `/chat?conversationId=${fixtureConversationId()}`, heading: "Conversa" },
  469 |     { name: "summary", path: `/resumo?conversationId=${fixtureCompletedConversationId()}`, heading: "Conversa finalizada" },
  470 |     { name: "words", path: "/palavras", heading: "Suas palavras" },
  471 |     { name: "word-detail", path: `/palavras/${fixtureWordId()}`, heading: "fixture" },
  472 |     { name: "calendar", path: "/calendario", heading: "Calendário" },
  473 |     { name: "calendar-detail", path: `/calendario/${fixtureFeedbackDate()}`, heading: fixtureFeedbackHeading() },
  474 |     { name: "progress", path: "/progresso", heading: "Progresso" },
  475 |     { name: "profile", path: "/perfil", heading: "Perfil" },
  476 |     { name: "connections", path: "/settings/connections", heading: "IA, Teable e Kokoro" },
  477 |     { name: "offline", path: "/offline", heading: "Você está sem conexão" }
  478 |   ];
  479 |   const viewports = [
  480 |     { width: 320, height: 568 },
  481 |     { width: 360, height: 800 },
  482 |     { width: 375, height: 812 },
  483 |     { width: 390, height: 844 },
  484 |     { width: 430, height: 932 }
  485 |   ];
  486 | 
  487 |   for (const viewport of viewports) {
  488 |     await page.setViewportSize(viewport);
  489 |     for (const surface of surfaces) {
  490 |       await page.goto(surface.path);
  491 |       await expect(page.getByRole("heading", { name: surface.heading, exact: false }).first()).toBeVisible();
  492 |       const layout = await page.evaluate(() => ({
  493 |         horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  494 |         clippedNavigation: Array.from(document.querySelectorAll<HTMLElement>(".nav-item"))
  495 |           .some((item) => item.scrollWidth > item.clientWidth + 1)
  496 |       }));
> 497 |       expect.soft(layout.horizontalOverflow, `${surface.name} overflows at ${viewport.width}px`).toBe(false);
      |                                                                                                  ^ Error: words overflows at 320px
  498 |       expect.soft(layout.clippedNavigation, `${surface.name} clips navigation at ${viewport.width}px`).toBe(false);
  499 |       await testInfo.attach(`${surface.name}-${viewport.width}x${viewport.height}`, {
  500 |         body: await page.screenshot({ fullPage: true }),
  501 |         contentType: "image/png"
  502 |       });
  503 |     }
  504 |   }
  505 | });
  506 | 
```