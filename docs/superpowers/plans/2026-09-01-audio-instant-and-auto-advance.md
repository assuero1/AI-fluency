# Áudio Instantâneo (warm no servidor) + Auto-avanço da Tradução — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O áudio de cada frase toca no instante em que ela aparece (pré-síntese no servidor durante a criação da sessão + burst inicial na fila do cliente) e, após a correção da tradução, o app avança sozinho para a próxima frase em ~2 segundos (sem botão "Continuar").

**Architecture:** A criação da sessão já leva 15–30s (IA escolhe palavras e frases) — é a janela perfeita para sintetizar áudio: `createNewWordsPractice` aguarda o warm das 2 primeiras frases (a 1ª toca instantânea) e devolve os textos restantes; a rota usa `after()` (Next 15) para pré-sintetizar o resto em background (concorrência 3). O `getOrCreateCachedSpeech` deduplica chamadas em voo (`inFlight`), então o pedido do cliente entra no mesmo warm — sem síntese duplicada. No cliente, a fila de prefetch ganha burst inicial (4 primeiras em 250ms) como fallback para cache-miss. No trainer, o painel de correção mostra o feedback por 2s com uma barrinha de contagem e avança sozinho.

**Tech Stack:** Next.js 15 (`after()` do next/server), Kokoro (`getOrCreateCachedSpeech`), Vitest.

**Spec:** Requisitos do usuário (2026-09-01, pós-deploy):
1. Áudio ainda mais rápido — tocar já no momento em que a frase aparece.
2. Após traduzir, mostrar a tradução esperada por ~2 segundos e partir para a próxima frase automaticamente (sem apertar "Continuar").

## Global Constraints

- Texto de UI em pt-BR; padrões iOS de áudio (elemento destravado em gesto + fallback visível) mantidos.
- Rate limit `voice-synthesize` 30/min: o warm no servidor NÃO passa pelo rate limit do middleware (é chamada interna de módulo), mas precisa de concorrência limitada (3) para não sobrecarregar o Kokoro; a fila cliente continua ≤30/min.
- Warm é best-effort: falha de síntese no warm NUNCA falha a criação da sessão (o fluxo de fallback do cliente continua existindo).
- Testes: `npm run test:unit` (falha temporal pré-existente em `tests/unit/word-senses-detail.test.ts` — ignorar/reportar), `npm run typecheck`, `npm run lint`; UI também `npm run build`.
- Contratos existentes não mudam de forma (a resposta do POST create ganha campo novo).

---

### Task 1: Warm do cache de áudio no servidor

**Files:**
- Modify: `lib/kokoro/cache.ts` (exportar `warmCachedSpeech`)
- Modify: `lib/learning/new-words.ts` (warm das 2 primeiras frases + retorno `pendingWarmTexts`)
- Modify: `app/api/practice/new-words/route.ts` (`after()` para o warm do restante)
- Test: `tests/unit/kokoro-warm.test.ts`

**Interfaces:**
- Produces: `warmCachedSpeech(texts: string[], languageCode: string | undefined): Promise<void>` (best-effort, concorrência 3, erros engolidos, dedupe via inFlight); resposta do POST create ganha `pendingWarmTexts: string[]` + `languageCode: string` (languageCode já existe no retorno).
- Consumes: `getKokoroConfig`, `selectKokoroVoice`, `normalizeSpeechLanguage`, `getOrCreateCachedSpeech` (todos já em `lib/kokoro/*`).

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/kokoro-warm.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { synthesizeSpeech } = vi.hoisted(() => ({ synthesizeSpeech: vi.fn() }));
vi.mock("../../lib/kokoro/client", () => ({
  synthesizeSpeech,
  KokoroRequestError: class extends Error {},
  streamSpeech: vi.fn(),
  captionedSpeech: vi.fn()
}));

describe("warmCachedSpeech", () => {
  beforeEach(() => {
    synthesizeSpeech.mockReset();
    synthesizeSpeech.mockResolvedValue({ audio: Buffer.alloc(8), contentType: "audio/mp3", outputFormat: "mp3" });
  });

  it("sintetiza todos os textos com concorrência limitada e engole erros", async () => {
    synthesizeSpeech.mockRejectedValueOnce(new Error("kokoro caiu"));
    const { warmCachedSpeech } = await import("../../lib/kokoro/cache");
    await expect(warmCachedSpeech(["a", "b", "c", "d"], "en")).resolves.toBeUndefined();
    expect(synthesizeSpeech.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("ignora lista vazia", async () => {
    const { warmCachedSpeech } = await import("../../lib/kokoro/cache");
    await expect(warmCachedSpeech([], "en")).resolves.toBeUndefined();
    expect(synthesizeSpeech).not.toHaveBeenCalled();
  });
});
```

> Ajuste o mock ao formato REAL que `synthesizeSpeech` retorna no arquivo `lib/kokoro/client.ts` (confira a assinatura antes de escrever) e à resolução de voz (o teste roda sem env de Kokoro — `getKokoroConfig` sem baseUrl deve retornar cedo; nesse caso o primeiro teste precisa de env: verifique como `tests/unit/kokoro-validation.test.ts` lida com config/env e siga o mesmo padrão).

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- kokoro-warm` → FAIL (função não existe).

- [ ] **Step 3: Implementar `warmCachedSpeech` em `lib/kokoro/cache.ts`** (seguindo o precedente `warmKokoroLanguage`):

```ts
/** Pré-sintetiza textos no cache (best-effort): concorrência 3, erros engolidos. */
export async function warmCachedSpeech(texts: string[], languageCode: string | undefined) {
  if (!texts.length) return;
  const config = getKokoroConfig();
  if (!config.baseUrl || !config.apiKey) return;
  const language = normalizeSpeechLanguage(languageCode);
  const voice = selectKokoroVoice(language, config.voicesByLanguage, config.defaultVoice);
  const queue = [...texts];
  const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const text = queue.shift()!;
      await getOrCreateCachedSpeech(text, { voice, format: config.outputFormat, speed: config.speed }).catch(() => undefined);
    }
  });
  await Promise.all(workers);
}
```

- [ ] **Step 4: Usar em `createNewWordsPractice`** (`lib/learning/new-words.ts`): logo depois do update para `status: "active"`:

```ts
  // Warm das 2 primeiras frases aguardado: a frase 1 toca instantânea. O resto
  // vai no after() da rota (resposta não espera).
  const warmTexts = sentences.map((sentence) => sentence.audioText);
  await warmCachedSpeech(warmTexts.slice(0, 2), profile.fields.language_code).catch(() => undefined);
```

e no retorno acrescente: `pendingWarmTexts: warmTexts.slice(2)`.

Importe `warmCachedSpeech` de `@/lib/kokoro/cache` (new-words.ts já é server-only).

- [ ] **Step 5: Rota com `after()`** (`app/api/practice/new-words/route.ts`, POST):

```ts
import { after } from "next/server";
import { warmCachedSpeech } from "@/lib/kokoro/cache";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { count?: unknown };
    const result = await createNewWordsPractice(body);
    const { pendingWarmTexts, languageCode } = result as { pendingWarmTexts?: string[]; languageCode?: string };
    if (pendingWarmTexts?.length) {
      after(() => warmCachedSpeech(pendingWarmTexts, languageCode));
    }
    return jsonOk({ ok: true, ...result }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
```

- [ ] **Step 6: Rodar** — `npm run test:unit -- kokoro-warm` → PASS; suíte + typecheck + lint + build → PASS.

- [ ] **Step 7: Commit** — `git commit -m "feat: pré-síntese das frases no servidor deixa o áudio instantâneo"`.

---

### Task 2: Burst inicial na fila do cliente (fallback)

**Files:**
- Modify: `lib/learning/audio-prefetch.ts`
- Test: `tests/unit/audio-prefetch.test.ts` (ajustar/casos novos)

**Interfaces:**
- Produces: `createAudioPrefetchQueue({ texts, request, spacingMs?, burstCount? = 4, burstSpacingMs? = 250 })` — os `burstCount` primeiros itens são agendados com `burstSpacingMs`; os demais com `spacingMs`.

- [ ] **Step 1: Teste (falha)** — acrescente:

```ts
  it("bursta as primeiras frases e espaça o restante", async () => {
    const request = vi.fn().mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c", "d", "e"], request, spacingMs: 2000, burstCount: 3, burstSpacingMs: 250 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(250);
    expect(request).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(4);
  });
```

- [ ] **Step 2: Implementar** — no `pump`, o espaçamento depende da posição: `const delay = pumped >= burstCount ? spacing : burstSpacingMs;` (controle via contador local; primeiro item imediato como hoje).

- [ ] **Step 3: Rodar** — testes + typecheck + lint → PASS. **Commit:** `feat: burst inicial no prefetch de áudio`.

---

### Task 3: Auto-avanço 2s após o julgamento (sem botão Continuar)

**Files:**
- Modify: `components/NewWordsTrainer.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- Comportamento: quando o julgamento chega (`setJudgment`), agenda avanço automático em 2000ms (`autoAdvanceRef`); renderiza barra de contagem (CSS `@keyframes` 2s, largura 100%→0) no painel de feedback; botão "Continuar" removido; tocar no painel de feedback avança imediatamente (`onClick` → cancelar timer + `continueToNext()`); limpar o timer em `abandonSession`, `resetAttempt`, unmount e antes de agendar de novo.

- [ ] **Step 1: Implementar no trainer**

```tsx
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelAutoAdvance = () => {
    if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; }
  };

  const advanceNow = () => {
    cancelAutoAdvance();
    void continueToNext();
  };
```

No `submitTranslation`, após `setJudgment(data.attempt.judgment); ...`:

```tsx
      cancelAutoAdvance();
      autoAdvanceRef.current = setTimeout(() => { autoAdvanceRef.current = null; void continueToNext(); }, 2000);
```

No painel de feedback (`flashcard-reveal`), trocar o bloco `recall-rating-grid` com o botão Continuar por:

```tsx
        <button className="flashcard-reveal auto-advance" onClick={advanceNow} type="button" aria-label="Avançar para a próxima frase">
          <span className="auto-advance-bar" />
        </button>
```

(`continueToNext` já guarda `busy` e trata última frase → complete.) Limpezas: `cancelAutoAdvance()` em `resetAttempt()` (cobre novo start/continue), em `abandonSession()` e num `useEffect(() => cancelAutoAdvance, [])` de unmount.

`app/globals.css`:

```css
.auto-advance { display: block; width: 100%; height: 6px; border: 0; padding: 0; background: transparent; cursor: pointer; }
.auto-advance-bar { display: block; height: 6px; border-radius: 3px; background: var(--section, var(--brand)); animation: auto-advance-countdown 2s linear forwards; }
@keyframes auto-advance-countdown { from { width: 100%; } to { width: 0%; } }
@media (prefers-reduced-motion: reduce) { .auto-advance-bar { animation-duration: 2s; animation-timing-function: linear; } }
```

- [ ] **Step 2: Rodar** — typecheck/lint/build + suíte → PASS; verificação manual: traduza uma frase → feedback + tradução esperada aparecem, a barrinha encolhe em 2s e a próxima frase abre com áudio; tocar na barrinha adianta; Sair/abandonar no meio não dispara avanço fantasma.

- [ ] **Step 3: Commit** — `feat: avanço automático 2s após a correção da tradução`.

---

## Verificação final

- [ ] Suíte verde exceto falha temporal conhecida; typecheck/lint/build PASS.
- [ ] QA E2E no ambiente QA: criar sessão → frase 1 toca imediatamente; traduzir → correção aparece ~2s e avança sozinha; última frase → resultado direto; abandonar durante a contagem não quebra.
- [ ] SW cache bump (v8) + push após merge.

## Riscos

- Warm no servidor consome Kokoro mesmo se a sessão for abandonada — custo aceito (app pessoal; cache reutiliza por texto).
- 2s é pouco para ler feedbacks longos — decisão explícita do usuário; tocar na barrinha adianta (não atrasa).
