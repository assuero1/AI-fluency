# Melhorias da Sessão de Palavras Novas — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mover o Calendário para o Perfil e dar à sessão de palavras novas uma aba própria na navegação, destacar a palavra nova na frase com sua tradução abaixo, corrigir o bug de sessões que abrem com menos palavras que as pedidas, subir para 6 frases por palavra e tornar o carregamento do áudio instantâneo.

**Architecture:** UI: `BottomNav` troca a entrada do Calendário pela aba "Novas" (`/palavras/novas`), o `NewWordsTrainer` passa a renderizar o próprio `AppShell` (nav visível no intro/resultado, oculta na sessão — padrão já usado pela página de chat), e o Calendário vira um botão no Perfil. Server: a geração de frases passa a ser por rodadas com retry direcionado às palavras faltantes + reposição de palavras novas quando a validação descarta alguma; `SENTENCES_PER_WORD` sobe para 6; um gerenciador de prefetch faz o áudio de todas as frases ser sintetizado em background em ritmo seguro para o rate limit, com prioridade para a frase corrente.

**Tech Stack:** Next.js App Router + TypeScript, Supabase (fachada TeableClient), IA via `createChatCompletion`, Kokoro via `requestSpeech`, Vitest.

**Spec:** Requisitos do usuário (2026-09-01):
1. Calendário vira botão dentro do Perfil.
2. O espaço da aba Calendário na navegação inferior vira a aba da modalidade "palavras novas" — deixa de ser o botão dentro da aba Palavras.
3. Na frase, destacar a palavra nova e mostrar a tradução dela embaixo.
4. Bug: às vezes a sessão abre com menos palavras que o pedido (apenas 1 palavra com 3 frases), mais frequente ao escolher 3 palavras — a sessão deve ter TODAS as palavras pedidas.
5. Mais de 5 frases por palavra nova.
6. O áudio está demorando; o carregamento de cada frase deve ser instantâneo.

## Global Constraints

- Todo texto de UI em pt-BR (padrão do app).
- Padrões iOS de áudio: `audio.play()` só funciona num `<audio>` destravado em gesto (`unlockAudioForPlayback`); fallback visível obrigatório.
- Rate limits vigentes (`lib/api/rate-limit.ts`): `voice-synthesize` 30/min — qualquer prefetch de áudio precisa caber nesse teto; `new-words-judge` sobe para 60/min nesta entrega (48 frases × 8 palavras).
- Migrações de banco: **nenhuma necessária** nesta entrega (nenhum schema muda).
- Testes: `npm run test:unit` (falha pré-existente conhecida em `tests/unit/word-senses-detail.test.ts`, temporal — ignorar/reportar), `npm run typecheck`, `npm run lint`; UI também `npm run build`.
- Sem rollback de SRS; contratos existentes (`NewWordsSentence`, `JudgedTranslation`, rotas) não mudam de forma — só ganham campos/comportamento.
- Pós-execução: deploy no VPS permanece pendente (o app do usuário só vê as mudanças após push + deploy).

---

## Análise (o que verificamos antes de planejar)

**Bug do item 4 — causa raiz confirmada no código (`lib/learning/new-words.ts`):**
1. **Uma única chamada de IA gera as frases de TODAS as palavras** com `maxTokens: 1600` fixo. Com 3 palavras × 3 frases + traduções, a resposta chega perto do teto; com o teto estourado o modelo simplesmente omite as últimas palavras (ou o JSON quebra e o retry integral repete o mesmo problema).
2. `generateNewWordSentences` aceita resultado parcial: `if (validated.droppedWordIds.length < newWords.length) return validated;` — se sobrou ≥1 palavra, a sessão abre com menos palavras.
3. `createNewWordsPractice` filtra `usable` e abre a sessão silenciosamente com o que sobrou (comportamento observado no QA: 7 e 5 frases em vez de 9).
4. A validação determinística (`validateGeneratedSentences`: ≤1 token lexical fora do vocabulário) derruba frases quando o banco do usuário é pequeno — agravando 1–3.

O usuário percebe "às vezes só 1 palavra" porque é exatamente o caso em que a validação só poupou as frases da primeira palavra. A correção ataca as 3 causas: geração por rodadas com retry SÓ das palavras faltantes, `maxTokens` proporcional ao volume, e reposição com palavras novas até completar o pedido.

**Item 6 — por que o áudio demora:** hoje a síntese começa só quando a frase aparece (lazy, `requestSpeech` no effect). Cada síntese Kokoro leva ~1–3s. A correção é prefetch: sintetizar TODAS as frases em background logo após a sessão abrir, em fila com espaçamento de 2,2s (≈27/min < teto de 30/min do `voice-synthesize`), com prioridade para a frase corrente — `requestSpeech` já deduplica requisições idênticas e cacheia, então fila + efeito atual compartilham a mesma promessa.

**Item 5 — custo aceito:** 6 frases/palavra ⇒ sessão de 8 palavras = 48 frases ⇒ 48 chamadas de julgamento (rate `new-words-judge` 30→60/min) e 48 sínteses (a fila de prefetch espaça para caber nos 30/min de voz; a sessão toda dura mais que o tempo de fila). Sem mudança de schema.

**Itens 1–2 — navegação:** `NavKey` mantém `"calendario"` (as páginas de calendário continuam existindo e tipadas; só saem da nav). `SectionKey` ganha `"novas"` com CSS aliasando as variáveis da seção palavras. O `NewWordsTrainer` passa a renderizar o próprio `AppShell` (precedente: `app/chat/page.tsx` alterna AppShell com/no nav por estado).

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `components/BottomNav.tsx` | Troca item Calendário → "Novas" (`/palavras/novas`, ícone Sparkles); `NavKey` ganha `"novas"` e mantém `"calendario"` |
| `components/AppShell.tsx` | `SectionKey` ganha `"novas"` |
| `app/globals.css` | Alias `.section-novas` (vars da seção palavras) + estilos `.sentence-target-word` e `.sentence-target-translation` |
| `app/perfil/page.tsx` | Botão/link "Calendário" acima do Logout |
| `components/FlashcardTrainer.tsx` | Remove o link "Aprender palavras novas" (item 2) |
| `app/palavras/novas/page.tsx` + `components/NewWordsTrainer.tsx` | Página renderiza o trainer "pelo"; trainer envolve cada tela no AppShell (nav no intro/resultado, oculta na sessão), destaque da palavra + tradução, copy de 6 frases, aviso de palavras a menos, wiring do prefetch |
| `lib/learning/new-words-contracts.ts` | `SENTENCES_PER_WORD = 6`; helper puro `splitSentenceAroundTarget(sentence, lemma)` |
| `lib/learning/new-words.ts` | Geração por rodadas com retry direcionado + reposição de palavras (top-up) |
| `lib/learning/audio-prefetch.ts` | Fila de prefetch de áudio (pura, request injetado) |
| `lib/api/rate-limit.ts` | `new-words-judge` 30 → 60/min |
| `tests/unit/new-words-*.test.ts`, `tests/unit/audio-prefetch.test.ts`, `tests/unit/api-rate-limit.test.ts`, `tests/unit/accessibility-contracts.test.ts` | Testes |

---

### Task 1: Navegação — aba "Novas", calendário no Perfil, shell do trainer

**Files:**
- Modify: `components/BottomNav.tsx`
- Modify: `components/AppShell.tsx`
- Modify: `app/globals.css` (alias de seção)
- Modify: `app/perfil/page.tsx`
- Modify: `components/FlashcardTrainer.tsx` (remover link)
- Modify: `app/palavras/novas/page.tsx` + `components/NewWordsTrainer.tsx` (shell)
- Test: `tests/unit/accessibility-contracts.test.ts`

**Interfaces:**
- Produces: `NavKey` = `"inicio" | "chat" | "palavras" | "novas" | "calendario" | "perfil"`; item de nav `{ key: "novas", label: "Novas", href: "/palavras/novas", Icon: Sparkles }` (sem item `calendario` no array); `SectionKey` ganha `"novas"`; `NewWordsTrainer` renderiza o próprio AppShell.

- [ ] **Step 1: Escrever o teste de contrato (falha)**

Acrescentar ao `describe` de `tests/unit/accessibility-contracts.test.ts`:

```ts
  it("move o calendário para o perfil e expõe a aba Novas", () => {
    const nav = read("components/BottomNav.tsx");
    expect(nav).toContain('key: "novas"');
    expect(nav).toContain('"/palavras/novas"');
    expect(nav).not.toMatch(/key: "calendario"/);
    expect(read("app/perfil/page.tsx")).toContain('href="/calendario"');
    expect(read("components/FlashcardTrainer.tsx")).not.toContain("/palavras/novas");
  });
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- accessibility-contracts` → FAIL.

- [ ] **Step 3: Implementar**

`components/BottomNav.tsx`:

```tsx
import { BookOpen, Home, MessageCircle, Sparkles, UserRound } from "lucide-react";

export type NavKey = "inicio" | "chat" | "palavras" | "novas" | "calendario" | "perfil";

const items = [
  { key: "inicio" as const, label: "Início", href: "/", Icon: Home },
  { key: "chat" as const, label: "Chat", href: "/chat", Icon: MessageCircle },
  { key: "palavras" as const, label: "Palavras", href: "/palavras", Icon: BookOpen },
  { key: "novas" as const, label: "Novas", href: "/palavras/novas", Icon: Sparkles },
  { key: "perfil" as const, label: "Perfil", href: "/perfil", Icon: UserRound }
];
```

(`"calendario"` permanece no tipo `NavKey` — as páginas `/calendario` continuam passando `activeNav="calendario"` e apenas não destacam aba alguma.)

`components/AppShell.tsx`: `SectionKey = "chat" | "palavras" | "novas" | "calendario" | "progresso" | "neutral"`.

`app/globals.css` (junto às outras seções, linha ~62):

```css
.section-novas { --section: var(--palavras); --section-deep: var(--palavras-deep); --section-soft: var(--palavras-soft); --section-text: var(--palavras-deep); }
```

`app/perfil/page.tsx` — entre `ProfilePreferences` e o bloco do logout:

```tsx
      <div className="px-4 pb-6">
        <Link className="outline-button full-button" href="/calendario"><CalendarDays /> Calendário</Link>
      </div>
```

(com `import Link from "next/link";` e `import { CalendarDays } from "lucide-react";` no topo.)

`components/FlashcardTrainer.tsx`: remover a linha `<Link className="outline-button full-button" href="/palavras/novas"><Sparkles /> Aprender palavras novas</Link>` (introduzida no plano anterior). Se `Sparkles` não tiver outro uso no arquivo, remova-a do import.

`app/palavras/novas/page.tsx` — passa a renderizar só o trainer (o AppShell vai para dentro do componente):

```tsx
import { NewWordsTrainer } from "@/components/NewWordsTrainer";

export const dynamic = "force-dynamic";

export default function NewWordsPracticePage() {
  return <NewWordsTrainer />;
}
```

`components/NewWordsTrainer.tsx` — reestruturar os 3 retornos para envolver cada tela no AppShell (o trainer vira o dono do shell, como o chat alterna por estado):

```tsx
import { AppShell } from "./AppShell";
```

No topo do corpo do componente, um helper interno:

```tsx
  const shell = (content: React.ReactNode, hideNav: boolean) => (
    <AppShell activeNav="novas" section="novas" noNav={hideNav}>{content}</AppShell>
  );
```

Trocar cada retorno:
- Tela de resultado: `return shell(<div className="flashcard-screen">…</div>, false);`
- Tela da sessão ativa (frase corrente): `return shell(<div className="flashcard-screen">…</div>, true);`
- Intro (com/sem modal de retomada): `return shell(<div className="flashcard-screen">…</div>, false);`

- [ ] **Step 4: Rodar** — `npm run test:unit -- accessibility-contracts` → PASS; `npm run typecheck` e `npm run lint` → PASS; `npm run build` → PASS.

- [ ] **Step 5: Verificação manual** — `npm run dev`: nav inferior mostra Início/Chat/Palavras/Novas/Perfil; aba "Novas" ativa o destaque no intro de `/palavras/novas`; o treino de cards não tem mais o link; Perfil tem o botão Calendário funcional; durante a sessão a nav some e volta no resultado.

- [ ] **Step 6: Commit**

```bash
git add components/BottomNav.tsx components/AppShell.tsx app/globals.css app/perfil/page.tsx components/FlashcardTrainer.tsx app/palavras/novas/page.tsx components/NewWordsTrainer.tsx tests/unit/accessibility-contracts.test.ts
git commit -m "feat: aba Novas na navegação, calendário no perfil e shell próprio do trainer"
```

---

### Task 2: Destacar a palavra nova na frase + tradução abaixo

**Files:**
- Modify: `lib/learning/new-words-contracts.ts`
- Modify: `components/NewWordsTrainer.tsx`
- Modify: `app/globals.css`
- Test: `tests/unit/new-words-target-highlight.test.ts`

**Interfaces:**
- Produces: `splitSentenceAroundTarget(sentence: string, lemma: string): { before: string; match: string; after: string } | null` (match = a ocorrência literal, case-insensitive, delimitada por início/fim/espaço/pontuação; `null` quando não acha — a UI faz fallback para a frase simples).
- Consumes: `current.sentence`, `current.targetWordId` e `words` (NewWordPreview[]) já presentes na sessão.

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/new-words-target-highlight.test.ts
import { describe, expect, it } from "vitest";
import { splitSentenceAroundTarget } from "../../lib/learning/new-words-contracts";

describe("splitSentenceAroundTarget", () => {
  it("separa a ocorrência exata da palavra-alvo", () => {
    expect(splitSentenceAroundTarget("I schedule the fixture today.", "schedule")).toEqual({
      before: "I ",
      match: "schedule",
      after: " the fixture today."
    });
  });

  it("é case-insensitive e preserva a forma original", () => {
    expect(splitSentenceAroundTarget("Schedule it now.", "schedule")?.match).toBe("Schedule");
  });

  it("não casa palavra dentro de outra palavra", () => {
    expect(splitSentenceAroundTarget("The rescheduled game.", "schedule")).toBeNull();
  });

  it("devolve null quando a palavra não está na frase", () => {
    expect(splitSentenceAroundTarget("Nothing here.", "schedule")).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- new-words-target-highlight` → FAIL.

- [ ] **Step 3: Implementar em `new-words-contracts.ts`**

```ts
/** Separa a frase na ocorrência inteira da palavra-alvo (case-insensitive) para destaque na UI. */
export function splitSentenceAroundTarget(sentence: string, lemma: string): { before: string; match: string; after: string } | null {
  const trimmedLemma = lemma.trim();
  if (!trimmedLemma) return null;
  const pattern = new RegExp(`(^|\\s|[.,;:!?¿¡])${lemma.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=$|\\s|[.,;:!?¿¡])`, "iu");
  const found = sentence.match(pattern);
  if (!found || found.index === undefined) return null;
  const leading = found[1] ?? "";
  const matchStart = found.index + leading.length;
  const matchEnd = matchStart + found[0].length - leading.length;
  return {
    before: sentence.slice(0, matchStart),
    match: sentence.slice(matchStart, matchEnd),
    after: sentence.slice(matchEnd)
  };
}
```

- [ ] **Step 4: Usar no trainer (`NewWordsTrainer.tsx`)**

No bloco da frase (`region "Frase para traduzir"`), trocar `<strong>{current.sentence}</strong>` por:

```tsx
        <strong>
          {(() => {
            const word = words.find((candidate) => candidate.wordId === current.targetWordId);
            const parts = word ? splitSentenceAroundTarget(current.sentence, word.lemma) : null;
            if (!parts) return current.sentence;
            return <>{parts.before}<mark className="sentence-target-word">{parts.match}</mark>{parts.after}</>;
          })()}
        </strong>
        <p className="sentence-target-translation">
          {(() => {
            const word = words.find((candidate) => candidate.wordId === current.targetWordId);
            return word ? `${word.lemma} · ${word.translation}` : "";
          })()}
        </p>
```

(importar `splitSentenceAroundTarget` de `@/lib/learning/new-words-contracts`.)

`app/globals.css`:

```css
.sentence-target-word { background: var(--section-soft, rgba(88, 204, 2, 0.16)); color: var(--section-text, #4a9c02); border-radius: 6px; padding: 0 4px; }
.sentence-target-translation { margin: 4px 0 0; font-size: 0.85rem; color: var(--text-soft, #6b7280); }
```

- [ ] **Step 5: Rodar** — `npm run test:unit -- new-words-target-highlight` → PASS; typecheck/lint/build → PASS; verificação manual: a palavra aparece destacada e a linha "lemma · tradução" abaixo da frase.

- [ ] **Step 6: Commit**

```bash
git add lib/learning/new-words-contracts.ts components/NewWordsTrainer.tsx app/globals.css tests/unit/new-words-target-highlight.test.ts
git commit -m "feat: destaque da palavra nova na frase com tradução abaixo"
```

---

### Task 3: Correção do bug — geração por rodadas + reposição de palavras

**Files:**
- Modify: `lib/learning/new-words.ts`
- Test: `tests/unit/new-words-generation.test.ts`

**Interfaces:**
- Consumes: `validateGeneratedSentences`, `generateNewWordProposals`, `createWordSense`, `canonicalVocabularyKey` (existentes).
- Produces (interno do módulo, testado via `createNewWordsPractice`):
  - `generateSentencesForWords(newWords, knownLemmas, language, level)` → mesmo shape de hoje, mas com 2 rodadas (round 2 pede SÓ as palavras ainda sem frase) e `maxTokens` dinâmico.
  - `createNewWordsPractice` passa a repor palavras: se `usable.length < count`, propõe palavras novas (excluindo as já propostas) e gera frases para elas, em até 2 rodadas de reposição. A sessão só abre depois disso (pode abrir com menos SÓ se as reposições falharem — e a UI avisa).

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/new-words-generation.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createChatCompletion } = vi.hoisted(() => ({ createChatCompletion: vi.fn() }));
vi.mock("../../lib/ai/client", () => ({ createChatCompletion }));
vi.mock("../../lib/supabase/client", () => ({
  getTeableClient: () => ({ records: [], async listRecordsWhereAll() { return [] as never; }, async listRecordsWhere() { return [] as never; }, async createRecord(table: string, fields: Record<string, unknown>) { return { id: `${table}-x`, fields }; }, async updateRecord(_t: string, id: string, f: Record<string, unknown>) { return { id, fields: f }; }, async createEvent() {} }),
  TeableRequestError: class extends Error { status = 409; }
}));
vi.mock("../../lib/learning/profile", () => ({
  getSessionUser: async () => ({ id: "user-1", fields: { timezone: "UTC" } }),
  getActiveLanguageProfile: async () => ({ id: "profile-1", fields: { language_code: "en", language_name: "Inglês", level: "Intermediário (B1)" } })
}));

import { generateSentencesForWords } from "../../lib/learning/new-words";

describe("generateSentencesForWords (geração por rodadas)", () => {
  beforeEach(() => createChatCompletion.mockReset());

  it("refaz SÓ as palavras sem frases válidas na 2ª rodada", async () => {
    createChatCompletion
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "I eat bread", translation: "eu como pão", word: "bread" },
        { text: "resposta lixo demais aqui fora", translation: "x", word: "milk" }
      ] }) })
      .mockResolvedValueOnce({ content: JSON.stringify({ sentences: [
        { text: "milk is good", translation: "leite é bom", word: "milk" }
      ] }) });
    const result = await generateSentencesForWords(
      [{ id: "w1", lemma: "bread" }, { id: "w2", lemma: "milk" }],
      ["eat", "good"], "Inglês", "B1"
    );
    expect(createChatCompletion).toHaveBeenCalledTimes(2);
    const secondPrompt = JSON.stringify(createChatCompletion.mock.calls[1][0]);
    expect(secondPrompt).toContain("milk");
    expect(secondPrompt).not.toContain("bread");
    expect(result.sentencesByWord.get("w1")).toHaveLength(1);
    expect(result.sentencesByWord.get("w2")).toHaveLength(1);
    expect(result.droppedWordIds).toEqual([]);
  });

  it("escala maxTokens com o volume de frases pedidas", async () => {
    createChatCompletion.mockResolvedValue({ content: JSON.stringify({ sentences: [] }) });
    const words = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, lemma: `word${i}` }));
    await generateSentencesForWords(words, [], "Inglês", "B1");
    const options = createChatCompletion.mock.calls[0][1] as { maxTokens?: number };
    expect(options.maxTokens).toBeGreaterThan(1600);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- new-words-generation` → FAIL (função não existe).

- [ ] **Step 3: Implementar em `new-words.ts`** — substituir `generateNewWordSentences` por:

```ts
const SENTENCE_TOKENS = 90;

/** Gera frases em até 2 rodadas; a 2ª pede somente as palavras que ficaram sem frase válida. */
export async function generateSentencesForWords(newWords: Array<{ id: string; lemma: string }>, knownLemmas: string[], language: string, level: string) {
  const buildCall = (targets: Array<{ id: string; lemma: string }>) => createChatCompletion([
    { role: "system", content: `Crie frases curtas de treino de tradução em ${language}, adequadas ao nível informado. Para CADA palavra da lista, crie exatamente ${SENTENCES_PER_WORD} frases — nenhuma palavra pode ficar sem frases. Regras: cada frase tem de 2 a 6 palavras; usa a palavra-alvo exatamente uma vez, como fornecida; usa SOMENTE palavras da lista de vocabulário conhecido do aluno, a própria palavra-alvo e palavras gramaticais muito comuns (artigos, preposições, pronomes, auxiliares); sentido claro e não ambíguo. Responda somente JSON válido: {"sentences":[{"text":"...","translation":"...","word":"lemma-da-palavra-alvo"}]}, com translation em português brasileiro.` },
    { role: "user", content: `Nível: ${level}\nPalavras-alvo: ${JSON.stringify(targets.map((word) => word.lemma))}\nVocabulário conhecido: ${JSON.stringify(knownLemmas.slice(0, MAX_KNOWN_VOCABULARY_IN_PROMPT))}` }
  ], {
    temperature: 0.5,
    // Proporcional ao volume: evita truncamento que omitia as últimas palavras.
    maxTokens: Math.min(6000, 400 + targets.length * SENTENCES_PER_WORD * SENTENCE_TOKENS),
    timeoutMs: 25_000,
    responseFormat: "json",
    disableThinking: true
  });

  let combined = { sentencesByWord: new Map<string, GeneratedSentence[]>(), droppedWordIds: [...newWords.map((word) => word.id)], rejectionReasons: {} as Record<string, number> };
  let pending = newWords;
  for (let round = 0; round < 2 && pending.length; round += 1) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, 600));
    try {
      const ai = await buildCall(pending);
      const parsed = parseJsonObject(ai.content) as { sentences?: unknown };
      const validated = validateGeneratedSentences(parsed.sentences, pending, knownLemmas);
      for (const [wordId, sentences] of validated.sentencesByWord) {
        combined.sentencesByWord.set(wordId, [...(combined.sentencesByWord.get(wordId) ?? []), ...sentences]);
      }
      for (const [reason, count] of Object.entries(validated.rejectionReasons)) {
        combined.rejectionReasons[reason] = (combined.rejectionReasons[reason] ?? 0) + count;
      }
      combined.droppedWordIds = newWords.filter((word) => !combined.sentencesByWord.get(word.id)?.length).map((word) => word.id);
    } catch { /* rodada falhou: segue para a próxima ou devolve o que tem */ }
    pending = newWords.filter((word) => combined.droppedWordIds.includes(word.id));
  }
  return combined;
}
```

E em `createNewWordsPractice`, depois de `const generation = await generateSentencesForWords(...)` e do cálculo de `usable`, adicionar a reposição (top-up) — o bloco de criação de palavras/sentidos (loop `for (const proposal of proposals)`) e a geração viram uma função local `buildWordsWithSentences(deficitCount, excludeLemmas)` reutilizada, e o fluxo fica:

```ts
  // 1ª leva de palavras + frases.
  let proposedLemmas = new Set(proposals.map((proposal) => normalizeVocabularyToken(proposal.lemma)));
  let { usable, sentences, generation } = await buildWordsWithSentences(proposals);
  // Reposição: completa o pedido com palavras novas enquanto houver déficit (máx. 2 rodadas).
  for (let topUp = 0; topUp < 2 && usable.length < count; topUp += 1) {
    const deficit = count - usable.length;
    const extraProposals = await generateNewWordProposals(
      knownWordsForPrompt.filter((word) => !proposedLemmas.has(normalizeVocabularyToken(word.lemma))),
      bankWords, deficit, language, level
    );
    const fresh = extraProposals.filter((proposal) => !proposedLemmas.has(normalizeVocabularyToken(proposal.lemma)));
    if (!fresh.length) break;
    fresh.forEach((proposal) => proposedLemmas.add(normalizeVocabularyToken(proposal.lemma)));
    const extra = await buildWordsWithSentences(fresh);
    usable = [...usable, ...extra.usable];
    sentences = [...sentences, ...extra.sentences];
  }
```

Onde `buildWordsWithSentences(proposalList)` encapsula o código que JÁ EXISTE (criar words + sentido primário; gerar frases para elas; montar `NewWordPreview[]` das utilizáveis) e devolve `{ usable, sentences, generation }` — os cards (`flashcards`) continuam sendo gravados UMA vez, no bloco atual, sobre a lista `usable` final. Nota: extrair o loop de criação de words/senses do fluxo atual para dentro de `buildWordsWithSentences` é refactor do próprio módulo; o comportamento de idempotência (`canonical_key`) não muda.

Se mesmo assim `usable.length < count`, incluir no retorno da rota/ação o campo `requestedWordCount: count` (o `words` já vai com o tamanho real) para a UI avisar.

- [ ] **Step 4: Rodar** — `npm run test:unit -- new-words` → PASS (os testes existentes de `new-words-session` podem precisar de ajuste se referenciavam `generateNewWordSentences` — renomear para a nova função); typecheck/lint → PASS.

- [ ] **Step 5: Aviso na UI (`NewWordsTrainer.tsx`)** — logo após montar a sessão no `start()`:

```tsx
      if ((data.words?.length ?? 0) < size) {
        setError(""); // sem erro bloqueante; aviso informativo durante a sessão
        setShortfallNotice(`Conseguimos montar frases para ${data.words?.length ?? 0} de ${size} palavras. As demais entram na próxima sessão.`);
      }
```

(estado `shortfallNotice` novo; renderizar como `<p className="row-meta">` sob a barra de progresso da sessão e limpar em `resetAttempt`/novo start.)

- [ ] **Step 6: Commit**

```bash
git add lib/learning/new-words.ts components/NewWordsTrainer.tsx tests/unit/new-words-generation.test.ts tests/unit/new-words-session.test.ts
git commit -m "fix: geração por rodadas com reposição garante as palavras pedidas na sessão"
```

---

### Task 4: 6 frases por palavra + rate limit de julgamento

**Files:**
- Modify: `lib/learning/new-words-contracts.ts` (`SENTENCES_PER_WORD`)
- Modify: `components/NewWordsTrainer.tsx` (copy)
- Modify: `lib/api/rate-limit.ts`
- Test: `tests/unit/api-rate-limit.test.ts` (caso novo)

**Interfaces:**
- Produces: `SENTENCES_PER_WORD = 6`; regra `new-words-judge` com `limitPerMinute: 60`.

- [ ] **Step 1: Escrever o teste (falha)** — acrescentar em `tests/unit/api-rate-limit.test.ts`:

```ts
it("new-words-judge tem teto de 60/min e cobre judge/complete/abandon", () => {
  const rule = matchApiRateLimitRule("/api/practice/new-words/judge");
  expect(rule?.name).toBe("new-words-judge");
  expect(rule?.limitPerMinute).toBe(60);
  expect(matchApiRateLimitRule("/api/practice/new-words/complete")?.name).toBe("new-words-judge");
  expect(matchApiRateLimitRule("/api/practice/new-words")?.name).toBe("new-words-create");
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- api-rate-limit` → FAIL.

- [ ] **Step 3: Implementar**

`lib/learning/new-words-contracts.ts`:

```ts
/** Frases por palavra nova (spec 2026-09-01: mais de 5). */
export const SENTENCES_PER_WORD = 6;
```

`lib/api/rate-limit.ts`: na regra `new-words-judge`, trocar `limitPerMinute: 30` por `limitPerMinute: 60` (48 julgamentos possíveis por sessão de 8 palavras).

`components/NewWordsTrainer.tsx` — a copy dos botões já usa `{option * SENTENCES_PER_WORD}`? Hoje usa literal `{option * 3} frases`. Trocar para usar a constante importada:

```tsx
          <button key={option} className={size === option ? "choice-card active" : "choice-card"} disabled={busy} onClick={() => setSize(option)} type="button">
            <div><strong>{option}</strong><span>palavras · {option * SENTENCES_PER_WORD} frases</span></div>
          </button>
```

e o parágrafo: `Cada palavra vem em {SENTENCES_PER_WORD} frases curtas. Ouça, traduza e a IA corrige na hora.` (importar `SENTENCES_PER_WORD` de `@/lib/learning/new-words-contracts`).

- [ ] **Step 4: Rodar** — `npm run test:unit` → PASS (atenção: `validateGeneratedSentences` usa `SENTENCES_PER_WORD` como cap — os testes de `new-words-sentence-validation` que dependem do cap 3 precisam de ajuste para o cap 6; conferir e atualizar expectativas); typecheck/lint/build → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/new-words-contracts.ts lib/api/rate-limit.ts components/NewWordsTrainer.tsx tests/unit/api-rate-limit.test.ts tests/unit/new-words-sentence-validation.test.ts
git commit -m "feat: 6 frases por palavra nova e teto de julgamento em 60/min"
```

---

### Task 5: Áudio instantâneo — fila de prefetch com prioridade

**Files:**
- Create: `lib/learning/audio-prefetch.ts`
- Modify: `components/NewWordsTrainer.tsx`
- Test: `tests/unit/audio-prefetch.test.ts`

**Interfaces:**
- Produces: `createAudioPrefetchQueue({ texts: string[], request: (text: string) => Promise<unknown>, spacingMs?: number })` → `{ start(): void; jumpTo(text: string): void; dispose(): void }`. Comportamento: deduplica textos; `start()` agenda as chamadas em fila com `spacingMs` (default 2200 ≈ 27/min < teto de 30/min do `voice-synthesize`); `jumpTo` move um texto para a frente da fila (sem duplicar); `dispose()` cancela o que não começou; erros de `request` são engolidos (o fallback visual existe).
- Consumes: `requestSpeech` (components/voice-shared) — já deduplica e cacheia por texto+idioma.

- [ ] **Step 1: Escrever o teste (falha)**

```ts
// tests/unit/audio-prefetch.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("fila de prefetch de áudio", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("agenda as chamadas com espaçamento e na ordem", async () => {
    const request = vi.fn().mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c"], request, spacingMs: 1000 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenNthCalledWith(1, "a");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(2, "b");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(3, "c");
  });

  it("jumpTo prioriza um texto pendente sem duplicar", async () => {
    const request = vi.fn().mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b", "c"], request, spacingMs: 1000 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    queue.jumpTo("c");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(2, "c");
    await vi.advanceTimersByTimeAsync(1000);
    expect(request).toHaveBeenNthCalledWith(3, "b");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("dispose cancela o restante e erros não quebram a fila", async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValue("url");
    const { createAudioPrefetchQueue } = await import("../../lib/learning/audio-prefetch");
    const queue = createAudioPrefetchQueue({ texts: ["a", "b"], request, spacingMs: 1000 });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    queue.dispose();
    await vi.advanceTimersByTimeAsync(5000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm run test:unit -- audio-prefetch` → FAIL.

- [ ] **Step 3: Implementar `lib/learning/audio-prefetch.ts`**

```ts
export type AudioPrefetchQueue = {
  start: () => void;
  jumpTo: (text: string) => void;
  dispose: () => void;
};

/**
 * Sintetiza os áudios das frases em background, em ritmo seguro para o rate
 * limit de síntese (~27/min com o espaçamento default de 2200ms), com
 * prioridade para a frase corrente via jumpTo. `request` é o requestSpeech
 * (já deduplica e cacheia), injetado para testabilidade.
 */
export function createAudioPrefetchQueue(options: {
  texts: string[];
  request: (text: string) => Promise<unknown>;
  spacingMs?: number;
}): AudioPrefetchQueue {
  const spacing = Math.max(0, options.spacingMs ?? 2200);
  let pending = options.texts.filter(Boolean);
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pump = () => {
    if (disposed || !pending.length) return;
    const text = pending.shift()!;
    void options.request(text).catch(() => undefined);
    if (pending.length) timer = setTimeout(pump, spacing);
  };

  return {
    start: pump,
    jumpTo: (text: string) => {
      if (disposed || !text || !pending.includes(text)) return;
      pending = [text, ...pending.filter((item) => item !== text)];
    },
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      pending = [];
    }
  };
}
```

- [ ] **Step 4: Ligar no trainer (`NewWordsTrainer.tsx`)**

```tsx
import { createAudioPrefetchQueue, type AudioPrefetchQueue } from "@/lib/learning/audio-prefetch";
```

Estado/ref: `const prefetchRef = useRef<AudioPrefetchQueue | null>(null);`

Novo effect — quando a sessão monta (lista de frases conhecida), sobe a fila:

```tsx
  useEffect(() => {
    if (!sentences.length || result) return;
    prefetchRef.current?.dispose();
    const queue = createAudioPrefetchQueue({
      texts: sentences.map((sentence) => sentence.audioText),
      request: (text) => requestSpeech(text, languageCode)
    });
    prefetchRef.current = queue;
    queue.start();
    return () => queue.dispose();
  }, [sentences, result, languageCode]);
```

No effect de autoplay existente, ANTES de `requestSpeech(current.audioText, ...)`, priorizar a frase corrente na fila:

```tsx
        prefetchRef.current?.jumpTo(current.audioText);
```

E no cleanup de fim/abandono (`abandonSession`, tela de resultado, unmount): `prefetchRef.current?.dispose();`.

Nota de correção: `requestSpeech` deduplica por chave texto+idioma, então o `jumpTo` + o efeito de autoplay compartilham a MESMA promessa — a frase corrente é sintetizada imediatamente mesmo estando no meio da fila, e as demais ficam prontas em background.

- [ ] **Step 5: Rodar** — `npm run test:unit -- audio-prefetch` → PASS; suíte inteira + typecheck + lint + build → PASS.

- [ ] **Step 6: Verificação manual** — sessão nova: a 1ª frase toca rápido (pedido direto) e, a partir da 2ª, o áudio sai instantâneo (já em cache). Confirmar no Network que as sínteses seguem espaçadas (~2,2s) e nenhuma recebe 429.

- [ ] **Step 7: Commit**

```bash
git add lib/learning/audio-prefetch.ts components/NewWordsTrainer.tsx tests/unit/audio-prefetch.test.ts
git commit -m "feat: prefetch de áudio em fila com prioridade para a frase corrente"
```

---

## Verificação final (task de fechamento)

- [ ] `npm run test:unit` — suíte verde exceto a falha temporal pré-existente conhecida.
- [ ] `npm run typecheck && npm run lint && npm run build` — PASS.
- [ ] QA E2E no ambiente de QA (`.env.qa.local`, `scripts/start-e2e-server.mjs`, mesma receita do QA anterior): sessão de 3 palavras abre com 3 palavras e 18 frases (ou aviso de déficit); palavra destacada + tradução abaixo em todas as frases; troca de frase com áudio instantâneo; nav inferior com aba Novas; calendário acessível pelo Perfil; dados do usuário de teste limpos com `qa-recover-fixture.mjs`.
- [ ] Deploy: push do main para origin + build/restart no VPS (docs/DEPLOYMENT.md) — sem isso o app do usuário não mostra nada do que está aqui.

## Riscos e decisões

- **"Mais de 5 frases" interpretado como 6** (`SENTENCES_PER_WORD = 6`). Se o desejo fosse outro número, é uma constante + copy.
- **Sessões mais longas**: 8 palavras × 6 frases = 48 julgamentos/sessão; com o teto de 60/min e a fila de áudio espaçada, tudo cabe nos limites atuais sem mexer no Kokoro.
- **Reposição de palavras (top-up) custa chamadas de IA extras** só quando a validação descarta palavras — o caminho feliz não paga nada.
- **Tradução visível antes de responder** (item 3) é escolha pedagógica explícita do usuário; o julgamento continua avaliando a tradução da FRASE, não da palavra isolada.
