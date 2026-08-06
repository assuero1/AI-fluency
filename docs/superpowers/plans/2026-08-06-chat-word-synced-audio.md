# Chat Word-Synced Audio (Karaokê por Palavra) — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Implement task-by-task; run the verification commands of each task before moving on.

## Goal

Trocar o player de áudio das bolhas da IA no chat de **síntese por frase** (com pausa/recarregamento entre frases) para **síntese da mensagem inteira com timestamps de palavra**: um único áudio fluido, com destaque palavra a palavra sincronizado, e navegação fina: **pular ±5 palavras** e **tocar a partir de uma palavra selecionada** (o usuário toca numa palavra e o play começa dela).

## Estudo / Evidências (verificado em 2026-08-06)

O servidor Kokoro em produção agora é `ph4r05/kokoro-fastapi` (`https://kokoro-tts-kokoro-fastapi.wud6zu.easypanel.host`), que **expõe timestamps de palavra** — o recurso que faltava no servidor antigo (hwdsl2). Verificação ao vivo:

- `POST /dev/captioned_speech` `{model, voice, input, response_format, speed, return_timestamps}` → **HTTP 200**, áudio completo (MP3/WAV) + header `X-Timestamps-Path: <file>.json`.
- `GET /dev/timestamps/<file>.json` → `[{"word":"Hello","start_time":0.25,"end_time":0.525}, …]` — sem auth.
- `POST /v1/audio/speech` continua compatível com o payload atual do app (o campo `stream_format` é ignorado).
- **Alinhamento 1:1 no caso comum:** texto de 3 frases → 26 tokens de fonte = 26 palavras com timestamp (tokenização simples `\w+|[^\w\s]`).
- **Risco real de normalização:** `She said "hello." Well… I don't know. E.g., it is 3-to-4.` → o servidor retorna 18 tokens (`"don't"`, `"E-g."`, `"3-to-4"` como uma palavra só) vs 27 tokens de uma tokenização ingênua. **O plano precisa de alinhamento robusto com fallback.**
- **Duração:** último `end_time` ≈ duração real do áudio − 0,1 s (padding); usar `audio.onended` para o estado `ended`, não o timestamp.
- **Limite do app:** `MAX_SYNTHESIS_TEXT_LENGTH = 1200` (`lib/kokoro/validation.ts`). Mensagens de chat normalmente cabem; para mensagens longas, segmentar por frases e encadear com offsets.

## Arquitetura / Decisões

1. **Nova rota aditiva `POST /api/voice/captioned`** — não altera `/api/voice/synthesize` nem `/api/voice/[audioId]`. Retorna `{ok, audioUrl, words, languageCode, cached}`.
2. **Cache:** o áudio usa o mesmo `audioId` (hash texto+voz+formato+speed) do `synthesize`, e os `words` ficam gravados no próprio metadata `{audioId}.json` (campo opcional `words`). Prune/removal existentes continuam funcionando sem mudança. Se um áudio em cache não tiver `words`, a rota captioned re-sintetiza (o servidor devolve áudio+timestamps juntos).
3. **Síntese eager na rota captioned** (diferente do `synthesize` lazy): o cliente precisa dos `words` na resposta, então a rota aguarda a síntese completa e grava áudio+words no disco.
4. **Segmentação por frases ≤ 1200 chars:** mensagens longas são divididas em segmentos (reutilizando `splitIntoSentences`), cada um sintetizado via captioned; o player encadeia os segmentos somando offsets (`start/end` globais = locais + soma dos `end_time` anteriores). Mensagens típicas = 1 segmento = áudio único fluido.
5. **Highlight por índice de token** (não por caractere): a lista de `words` do servidor é a fonte de verdade; o texto exibido é o original, mapeado por alinhamento de tokens. Se o alinhamento falhar em trechos, o trecho não destacável fica sem timestamp (sem quebrar o fluxo); se a taxa de match for muito baixa, degrada para o destaque por frase atual.
6. **Fallback:** se `/api/voice/captioned` falhar (servidor antigo/offline), o player cai para o fluxo atual de síntese por frase + `speechSynthesis`, com beacon `voice_device_fallback` único (reuso de `voice-shared.ts`).
7. **UX:** tocar numa palavra **seleciona** (start point, visual `.selected`); o play toca da palavra selecionada. Skip ±5 palavras: tocando → seek e continua; pausado/idle → move a seleção sem tocar (mesmo contrato do player atual).
8. **Restrições herdadas:** sem dependência nova; `msUntilAudioRouteRestored()` antes de `audio.play()` (iOS); coordenação de voz ativa via `claimActiveVoice`/`releaseActiveVoice`; `showTranscript=false` → só controles; testes Vitest em `tests/unit/*.test.ts` com alias `@/`.

---

### Fase 1: Backend — client, cache e rota `/api/voice/captioned`

**Files:**
- Modify: `lib/kokoro/client.ts` (adicionar `captionedSpeech`)
- Modify: `lib/kokoro/cache.ts` (persistir/ler `words` no metadata; `prepareCaptionedSpeech`)
- Modify: `lib/kokoro/validation.ts` (limite e opções para captioned — reusar `resolveSynthesisRequest`)
- Create: `app/api/voice/captioned/route.ts`
- Test: `tests/unit/kokoro-captioned.test.ts` (client + rota com fetch mockado)

**Interfaces:**
- `captionedSpeech(input, options): Promise<{ audioBuffer: Buffer; contentType: string; words: WordTimestamp[]; voice: string; outputFormat: string }>`
- `prepareCaptionedSpeech(input, options): Promise<{ audioId; audioUrl; words; contentType; outputFormat; voice; cached }>`
- `POST /api/voice/captioned` body `{text, languageCode?}` → `{ok, audioUrl, words, languageCode, cached}` (erros no padrão `handleApiError`).

- [x] **Step 1: Tipos e client**

Adicionar em `lib/kokoro/client.ts` (ou `lib/kokoro/timestamps.ts`):

```ts
export type WordTimestamp = { word: string; start_time: number; end_time: number };

export async function captionedSpeech(input: string, options?: { voice?: string; format?: string; speed?: number }) {
  // POST {baseUrl}/dev/captioned_speech com {model:"kokoro", voice, input, response_format, speed, return_timestamps:true}
  // Se !ok → KokoroRequestError (mesmo padrão do synthesizeSpeech).
  // Ler header x-timestamps-path → GET {baseUrl}/dev/timestamps/{file}
  // Retornar { audioBuffer, contentType, words, voice, outputFormat }
}
```

- [x] **Step 2: Cache — `words` no metadata**

Em `lib/kokoro/cache.ts`:
- Estender `CachedAudioMetadata` com `words?: WordTimestamp[]`.
- Criar `prepareCaptionedSpeech(input, options)`: valida via `resolveSynthesisRequest`; calcula `audioId` (mesmo `createAudioId`); se `getCachedSpeech(audioId)` existir **e** o metadata tiver `words`, retorna com `cached: true`; senão chama `captionedSpeech`, persiste áudio+metadata (com `words`) usando o mesmo fluxo atômico de `createCachedSpeech`, e retorna `{audioId, audioUrl, words, ...}`.
- `removeCachedFiles`/prune não mudam (o campo `words` vive dentro do `{audioId}.json`).

- [x] **Step 3: Rota**

`app/api/voice/captioned/route.ts` (padrão de `app/api/voice/synthesize/route.ts`):

```ts
export async function POST(request: Request) {
  // body {text?, languageCode?}
  // language → voz (selectKokoroVoice) e languageCode de resposta (normalizeSpeechLanguage)
  // const result = await prepareCaptionedSpeech(text, {voice, format, speed: config.speed});
  // return jsonOk({ ok: true, languageCode, ...result });
}
```

- [x] **Step 4: Testes**

`tests/unit/kokoro-captioned.test.ts`: mock de `global.fetch` para `captionedSpeech` (200 com header `x-timestamps-path` + GET do JSON; erro 4xx/5xx); rota: validação de texto vazio/longo/voz não permitida; resposta `{ok, audioUrl, words}`; cache hit com `words` no metadata; cache hit sem `words` → re-sintetiza.

- [x] **Step 5: Verificação**

Run: `npm run lint && npm run typecheck && npm run test:unit`
Expected: verde. Smoke real (dev server + novo `KOKORO_BASE_URL`):

```bash
curl -s -X POST http://localhost:3012/api/voice/captioned -H "Content-Type: application/json" \
  -d '{"text":"Hello there. How are you today?","languageCode":"en"}'
# Esperado: {ok:true, audioUrl, words:[...], languageCode:"en"}
```

- [x] **Step 6: Commit**

```bash
git add lib/kokoro/client.ts lib/kokoro/cache.ts lib/kokoro/validation.ts app/api/voice/captioned/route.ts tests/unit/kokoro-captioned.test.ts
git commit -m "feat: add captioned speech endpoint with word timestamps"
```

---

### Fase 2: Alinhamento e utilidades de sincronia (`lib/learning/captions.ts`)

**Files:**
- Create: `lib/learning/captions.ts`
- Test: `tests/unit/captions.test.ts`

**Interfaces:**
- `tokenizeForCaptions(text: string): CaptionToken[]` — tokens de exibição (palavras + pontuação), agrupando apóstrofo/hífen internos (`don't`, `3-to-4`).
- `alignWords(tokens: CaptionToken[], words: WordTimestamp[]): AlignedToken[]` — mapeia índice do token exibido → timestamp (com fallback de alinhamento e marca de "sem timestamp").
- `wordIndexAtTime(words: WordTimestamp[], time: number): number` — busca binária.
- `clampWordIndex(words, index): number`.
- `skipWordIndex(words, index, delta, step = 5): number`.
- `segmentMessage(text: string, maxLength = 1200): string[]` — agrupa frases em segmentos ≤ limite (reusa `splitIntoSentences`).

- [x] **Step 1: Testes (TDD)**

Casos obrigatórios (extraídos do estudo):
- texto simples com pontuação → 1:1 com `words` do servidor (26/26).
- `don't`, `E.g.,`, `3-to-4` → contagem igual à do servidor (18/18).
- `words` do servidor com token normalizado (`E-g.`) → alinhamento por similaridade (fallback) e token exibido sem timestamp quando não casa.
- `wordIndexAtTime` com tempos nos limites (`start` incluso, `end` exclusivo) e fora da faixa (antes do 1º → 0; depois do último → último).
- `skipWordIndex` com clamping (início/fim) e step 5.
- `segmentMessage`: frases curtas juntam; frase longa (sem pontuação) vira segmento único mesmo acima do limite (não cortar palavra).

- [x] **Step 2: Implementação**

```ts
export type WordTimestamp = { word: string; start_time: number; end_time: number };
export type CaptionToken = { text: string; isWord: boolean };
export type AlignedToken = { text: string; start?: number; end?: number };

// tokenize: /[A-Za-zÀ-ÿ0-9]+(?:['’\-][A-Za-zÀ-ÿ0-9]+)*|[^\w\s]/g (palavra mantém apóstrofo/hífen internos)
// alignWords: se contagem == → 1:1; senão alinhamento guloso por forma normalizada
//   (minúsculas, remover pontuação de borda, "e.g."→"eg") com lookahead; tokens sem par
//   ficam sem timestamp (start/end undefined) e não quebram o fluxo.
// segmentMessage: acumula frases enquanto soma de chars <= maxLength.
```

- [x] **Step 3: Verificação**

Run: `npx vitest run tests/unit/captions.test.ts` → PASS; depois `npm run lint && npm run typecheck`.

- [x] **Step 4: Commit**

```bash
git add lib/learning/captions.ts tests/unit/captions.test.ts
git commit -m "feat: word timestamp alignment and seek utilities"
```

---

### Fase 3: Player word-level (`components/MessageWordPlayer.tsx`)

**Files:**
- Create: `components/MessageWordPlayer.tsx`
- (Mantém `MessageAudioPlayer.tsx` no repo durante a Fase 4/5; remoção é passo opcional final.)

**Comportamento (contrato):**
- Carrega a mensagem via `/api/voice/captioned` (segmentada se necessário) → lista global de `AlignedToken` com `start/end` absolutos e uma lista de `<audio>` (1 no caso comum).
- `timeupdate` no áudio ativo → `wordIndexAtTime` → destaca a palavra ativa (estado troca só quando o índice muda).
- `idle` → play: toca do `selectedIndex` (0 inicial); fim do último áudio → `ended`.
- `playing` → pause: pausa o áudio atual; resume continua.
- Skip ±5 palavras **tocando**: `audio.currentTime = words[target].start` (e muda de segmento se necessário); **pausado/idle**: só move a seleção (destaque acompanha).
- Tocar numa palavra → seleciona (`.selected`); play começa dela.
- Se `showTranscript=false` → só controles (nunca as palavras).
- Preload da última mensagem (prop `preload`) via captioned.
- Fallback (captioned indisponível): usa a lógica atual de frases (`requestSpeech`/`playDeviceSpeech` do `voice-shared.ts`) com beacon único — destacando por frase (mesmo comportamento do player atual).
- iOS: `msUntilAudioRouteRestored()` antes de `play()`; coordenação: `claimActiveVoice`/`releaseActiveVoice`; só um áudio por vez no app.

**Estados:** `idle | loading | playing | paused | ended | error`.

- [x] **Step 1: Criar o componente** (esqueleto + fluxo principal captioned)

```tsx
// Estrutura de estado:
//   segments: AlignedToken[] (global, com offsets aplicados)
//   audioRefs: HTMLAudioElement[] (um por segmento)
//   activeSegmentRef: número do segmento tocando
//   selectedRef / selectedIndex: palavra de partida
// timeupdate handler: se wordIndex mudou → setActiveWord(index)
// seekToWord(index): acha segmento/token, seta audioRefs[seg].currentTime = token.start
// togglePlayback / skipWords(delta) seguem o contrato acima
```

- [x] **Step 2: Verificar compilação**

Run: `npm run lint && npm run typecheck` → verde (componente ainda não usado).

- [x] **Step 3: Commit**

```bash
git add components/MessageWordPlayer.tsx
git commit -m "feat: add word-synced message audio player"
```

---

### Fase 4: Integração no chat + CSS

**Files:**
- Modify: `components/ChatConversation.tsx` (trocar `MessageAudioPlayer` → `MessageWordPlayer` na bolha da IA; manter `VoiceButton` nas correções)
- Modify: `app/globals.css` (estilos novos após o bloco do player de frases)

- [x] **Step 1: Trocar o componente na bolha da IA**

Mesma chamada: `<MessageWordPlayer languageCode={speechLanguage} preload={!readOnly && message.id === latestAssistantMessageId} showTranscript={transcriptEnabled} text={message.fields.text} />` e atualizar o import.

- [x] **Step 2: CSS**

```css
/* Word-synced chat audio player */
.chat-words { display: flex; flex-wrap: wrap; gap: 0; line-height: 1.6; }
.chat-word { border-radius: 4px; padding: 0 1px; transition: background-color 120ms ease; cursor: pointer; }
.chat-word.active { background: var(--section-soft); font-weight: 600; }
.chat-word.selected { box-shadow: inset 0 -2px 0 var(--section); }
.chat-word.muted { opacity: 0.45; } /* token sem timestamp (fallback de alinhamento) */
/* .word-player-controls reusa .line-player-controls + botões +5/-5 */
```

- [x] **Step 3: Verificação**

Run: `npm run lint && npm run typecheck && npm run test:unit` → verde.

- [x] **Step 4: Commit**

```bash
git add components/ChatConversation.tsx app/globals.css
git commit -m "feat: word-synced audio player in chat assistant messages"
```

---

### Fase 5: Verificação final, QA manual e rollback

- [x] **Step 1: Gate completo**

Run: `npm run lint && npm run typecheck && npm run test:unit` → verde.

- [x] **Step 2: Smoke de integração real (dev server + Kokoro fastapi)**

Run: `npm run dev`, e validar via curl:
1. `POST /api/voice/captioned` (texto curto e texto com `E.g., don't, 3-to-4`) → `words` com contagem alinhada ao esperado da Fase 2.
2. Repetir a mesma chamada → `cached: true`.
3. `GET /api/voice/{audioId}` → áudio 200.
4. Mensagem > 1200 chars → múltiplos segmentos com offsets crescentes.

- [ ] **Step 3: QA manual (navegador/celular)**

1. Play → destaque palavra a palavra, sem pausa/recarregamento no meio (fluido).
2. Tocar numa palavra → seleção; play → áudio começa daquela palavra.
3. Skip +5/−5 tocando → salta e continua; pausado → só move a seleção.
4. Pause/resume no meio de uma palavra → continua do mesmo ponto.
5. Play em 2ª bolha → a 1ª para e reseta.
6. Player + `VoiceButton` de correção → o player para.
7. Recarregar e tocar de novo → instantâneo (cache do app).
8. Transcript desligado → só controles.
9. Kokoro fora do ar → fallback por frase com destaque por frase (comportamento antigo) + beacon.
10. Mensagem longa (>1200) → encadeia segmentos sem pausa perceptível; highlight contínuo.

- [ ] **Step 4: Rollback**

Reverter só o `ChatConversation.tsx` (voltar para `MessageAudioPlayer`); o endpoint `/api/voice/captioned` é aditivo e pode permanecer. O `MessageAudioPlayer` antigo fica no repo até a Fase 5 confirmar a estabilidade do novo.

- [ ] **Step 5: Commit final (se houve ajustes do QA)**

```bash
git add -A
git commit -m "fix(chat): word player QA adjustments"
```

---

## Self-Review (a completar pelo implementador)

- **Cobertura da spec:** áudio fluido sem gaps (síntese única + captioned) ✔; destaque palavra a palavra sincronizado (timeupdate + `wordIndexAtTime`) ✔; skip ±5 palavras (seek/selection) ✔; play a partir de palavra selecionada ✔; fallback por frase preservado ✔.
- **Riscos conhecidos:** normalização do servidor pode desalinhar tokens → alinhamento com fallback (Fase 2) e degradação para destaque por frase se o match for baixo; latência da primeira síntese em mensagens grandes → segmentação + preload da última mensagem; drift de offset entre segmentos (<0,1 s/segmento) → aceito e documentado.
- **Compatibilidade:** nenhuma dependência nova; `/api/voice/*` existentes intactos; rota captioned aditiva; coordenação de voz e regras iOS preservadas.

## Fora de escopo (próximos passos possíveis)

- Streaming de áudio com TTFB menor (o fastapi tem `stream: true` no `/v1/audio/speech`, mas sem timestamps) — avaliar se o tempo de síntese total virar problema.
- Preload de todas as mensagens visíveis (não só a última).
- Remover `MessageAudioPlayer` após período de estabilidade.
