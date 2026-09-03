# Plano 3 — Progresso (P2): XP, nível real, gráficos, heatmap, onboarding e analytics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o progresso visível e honesto: XP com moeda única, nível real derivado de domínio (fim da barra fake), gráficos de evolução, calendário em heatmap, onboarding em wizard com momento de conclusão, espera "com graça" no preparo das palavras novas e o mínimo de analytics para provar que as três fases funcionaram.

**Architecture:** Uma migração pequena (`users.xp_total`, `users.quest_xp_keys`). `lib/learning/xp.ts` centraliza premiação (chamado nos hooks que o Plano 2 já instrumentou); `lib/learning/level.ts` deriva nível/percentual de domínio real. UI: `MiniChart` (SVG puro), heatmap por classes CSS no calendário, wizard de 3 passos no onboarding, tela de espera animada no trainer. Analytics é um script Node + doc (sem dashboard).

**Tech Stack:** Next.js 15 + React 19, SVG puro (sem lib de gráficos), Supabase/Postgres, scripts Node.

**Spec:** [docs/ESTUDO_ENGAJAMENTO_RETENCAO.md](../../ESTUDO_ENGAJAMENTO_RETENCAO.md) — seção 4, itens R11–R15 (Fase 4 do roadmap). **Pré-requisitos:** Planos 1 e 2 concluídos (hooks de conclusão, conquistas e missões já existem).

## Global Constraints

- Nenhuma dependência nova de npm (gráficos em SVG puro; analytics em script Node com o client Supabase existente).
- `levelProgress()` fake é **apagado**, não mantido em paralelo (supersessão explícita).
- XP é(server-side) — o cliente nunca manda "ganhei XP"; toda premiação passa por `awardXp`.
- Números de progresso são honestos: se não há dado suficiente, a UI diz o que falta ("Conclua uma conversa para medir") — nunca inventa percentual.
- Migração 0009 aditiva e idempotente; bump `CACHE_NAME` v17 no release.
- QA/commits no padrão do repo; testes unitários para toda função pura.

## Supersessões (decisões "deixa o melhor")

| Deixa de existir | Substituído por |
|---|---|
| `levelProgress()` com 20/55/82% hardcoded (`progress.ts:275-282`) | `computeLevelProgress()` derivado de palavras consolidadas + fluência |
| Recompensa simbólica das missões (`xpAward` reservado no Plano 2) | Missões pagam XP de verdade na conclusão |
| Onboarding de formulário único (`OnboardingForm.tsx`) | Wizard de 3 passos + tela "Perfil pronto!" |
| Espera do deck com label no botão (`NewWordsTrainer.tsx:529-531`) | Tela de preparo animada com dicas |
| Calendário com dots neutros | Heatmap de intensidade + streak no mês |

## File Structure

- Create: `supabase/migrations/0009_xp.sql`
- Create: `lib/learning/xp.ts` — XP_RATE_TABLE + `awardXp` + `awardQuestXpIfNew`
- Create: `lib/learning/level.ts` — nível/percentual real
- Create: `components/MiniChart.tsx`, `components/PreparingCards.tsx`, `components/OnboardingWizard.tsx`
- Modify: `lib/learning/progress.ts` (apaga `levelProgress`, usa `level.ts`, payload de gráficos), `app/progresso/page.tsx`, `lib/learning/feedback.ts` (`getCalendarData` ganha intensidade), `app/calendario/page.tsx`, `app/globals.css`
- Modify: hooks do Plano 2 (feedback/flashcards/new-words) para premiar XP; `lib/learning/achievements.ts` (conquista paga 25 XP); `components/QuestList.tsx` (exibe `xpAward`)
- Modify: `app/onboarding/page.tsx`, `components/OnboardingForm.tsx` (refactor para wizard)
- Modify: `components/NewWordsTrainer.tsx` (tela de preparo), `components/StartFlashcardsWithWords.tsx` (evento `cta_clicked`)
- Create: `scripts/analytics-report.mjs`, `docs/ANALYTICS_ENGAJAMENTO.md`
- Test: `tests/unit/xp.test.ts`, `tests/unit/level.test.ts`, `tests/unit/mini-chart.test.ts`

---

### Task 1: Migração 0009 + serviço de XP

**Files:**
- Create: `supabase/migrations/0009_xp.sql`
- Create: `lib/learning/xp.ts`
- Test: `tests/unit/xp.test.ts`

**Interfaces:**
- Produces: `XP_AMOUNTS = { conversation: 25, flashcards: 15, new_words: 20, quest: { base: 10 }, achievement: 25 }` e `awardXp(userId: string, amount: number, reason: string): Promise<number>` (incrementa `users.xp_total`, cria evento `xp_awarded` com `{ amount, reason }`, devolve o total).
- Produces: `awardQuestXpIfNew(userId: string, dayStamp: string, quests: Array<{ key: string; complete: boolean; xpAward: number }>): Promise<number>` — guarda chaves `key:dayStamp` já pagas em `users.quest_xp_keys` (jsonb) e paga só as recém-concluídas.

- [ ] **Step 1: Migração**

```sql
-- 0009: XP como moeda única de progresso.
alter table users add column if not exists xp_total integer not null default 0;
alter table users add column if not exists quest_xp_keys jsonb not null default '[]'::jsonb;
```

Run: `npm run supabase:apply-schema`

- [ ] **Step 2: Teste (falha primeiro)**

```ts
// tests/unit/xp.test.ts
import { describe, expect, it } from "vitest";
import { XP_AMOUNTS, questsToAward } from "@/lib/learning/xp";

describe("questsToAward", () => {
  it("paga só missões recém-concluídas do dia e nunca repete", () => {
    const quests = [
      { key: "finish_conversation", complete: true, xpAward: 10 },
      { key: "learn_words", complete: true, xpAward: 10 },
      { key: "practice_minutes", complete: false, xpAward: 15 }
    ];
    const alreadyPaid = ["finish_conversation:2026-09-03"];
    const award = questsToAward("2026-09-03", quests, alreadyPaid);
    expect(award).toEqual([{ key: "learn_words", amount: 10 }]);
  });
});

describe("XP_AMOUNTS", () => {
  it("conversa vale mais que treino, e nenhum prêmio é zero", () => {
    expect(XP_AMOUNTS.conversation).toBeGreaterThan(XP_AMOUNTS.flashcards);
    expect(XP_AMOUNTS.achievement).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run tests/unit/xp.test.ts` → Expected: FAIL

- [ ] **Step 3: Implementar**

```ts
// lib/learning/xp.ts
import { getTeableClient, type TeableRecord } from "@/lib/supabase/client";

export const XP_AMOUNTS = {
  conversation: 25,
  flashcards: 15,
  new_words: 20,
  quest: { base: 10 },
  achievement: 25
} as const;

export function questsToAward(dayStamp: string, quests: Array<{ key: string; complete: boolean; xpAward: number }>, alreadyPaid: string[]) {
  const paid = new Set(alreadyPaid);
  const award: Array<{ key: string; amount: number }> = [];
  for (const quest of quests) {
    const questKey = `${quest.key}:${dayStamp}`;
    if (!quest.complete || paid.has(questKey)) continue;
    award.push({ key: questKey, amount: quest.xpAward > 0 ? quest.xpAward : XP_AMOUNTS.quest.base });
  }
  return award;
}

export async function awardXp(userId: string, amount: number, reason: string) {
  if (amount <= 0) return 0;
  const client = getTeableClient();
  const [user] = await client.listRecordsWhere<{ xp_total?: number }>("users", "id", userId);
  const total = Number(user?.fields.xp_total ?? 0) + amount;
  if (user) await client.updateRecord<{ xp_total: number }>("users", user.id, { xp_total: total });
  await client.createEvent(userId, "xp_awarded", { amount, reason });
  return total;
}

export async function awardQuestXpIfNew(userId: string, dayStamp: string, quests: Array<{ key: string; complete: boolean; xpAward: number }>) {
  const client = getTeableClient();
  const [user] = await client.listRecordsWhere<{ quest_xp_keys?: string[] }>("users", "id", userId);
  const paid: string[] = Array.isArray(user?.fields.quest_xp_keys) ? user.fields.quest_xp_keys : [];
  const awards = questsToAward(dayStamp, quests, paid);
  if (!awards.length || !user) return 0;
  const total = awards.reduce((sum, award) => sum + award.amount, 0);
  await client.updateRecord<{ quest_xp_keys: string[]; xp_total: number }>("users", user.id, {
    quest_xp_keys: [...paid, ...awards.map((award) => award.key)].slice(-400),
    xp_total: Number(user.fields.xp_total ?? 0) + total
  });
  await client.createEvent(userId, "xp_awarded", { amount: total, reason: "quests" });
  return total;
}
```

(Se `quest_xp_keys` vier como string JSON do banco, fazer parse defensivo antes do `Array.isArray`.)

- [ ] **Step 4: Verde**

Run: `npx vitest run tests/unit/xp.test.ts && npm run typecheck`

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_xp.sql lib/learning/xp.ts tests/unit/xp.test.ts
git commit -m "feat(progresso): XP como moeda única com premiação server-side"
```

---

### Task 2: Premiar XP nos hooks (sessões, missões e conquistas)

**Files:**
- Modify: `lib/learning/feedback.ts` (`finalizeConversation`) — após o evento `conversation_completed`: `await awardXp(user.id, XP_AMOUNTS.conversation, "conversation")` e `awardQuestXpIfNew(...)` com snapshot de missões pós-sessão (montado como no `home.ts` do Plano 2, Task 6 — extraia a coleta de inputs de missões para `lib/learning/quests.ts` como `export async function collectQuestInputs(userId, profileId, dayStamp)` para reuso).
- Modify: `lib/learning/flashcards.ts` (`completeFlashcardPractice`) — `awardXp(XP_AMOUNTS.flashcards, "flashcards")` + missões (score de hoje muda) + concluir "clear_queue" quando aplicável.
- Modify: `lib/learning/new-words.ts` (complete) — `awardXp(XP_AMOUNTS.new_words, "new_words")` + missões.
- Modify: `lib/learning/achievements.ts` — dentro do loop de desbloqueio, `await awardXp(userId, XP_AMOUNTS.achievement, `achievement:${definition.key}`)`.

- [ ] **Step 1: Ligar as premiações** — os hooks já têm o usuário e o momento; ordem dentro do hook: (1) computa quest inputs pós-sessão, (2) `awardQuestXpIfNew`, (3) `awardXp` da sessão, (4) `evaluateAchievements` (que premia as conquistas novas). Falha de XP **nunca** derruba a conclusão da sessão: envolver em `try { … } catch { /* XP é best-effort */ }`.

- [ ] **Step 2: Verificar**

Run: `npm run test:unit && npm run typecheck && npm run build`
QA manual: concluir um treino → `users.xp_total` sobe 15 (+XP de missão/conquista se houver); eventos `xp_awarded` visíveis; falha simulada de XP não quebra a resposta do complete.

- [ ] **Step 3: Commit**

```bash
git add lib/learning/feedback.ts lib/learning/flashcards.ts lib/learning/new-words.ts lib/learning/achievements.ts lib/learning/quests.ts
git commit -m "feat(progresso): sessões, missões e conquistas pagam XP"
```

---

### Task 3: Nível real (apaga a barra fake)

**Files:**
- Create: `lib/learning/level.ts`
- Modify: `lib/learning/progress.ts` — **apagar** `levelProgress()` (`:275-282`) e usar o novo; payload ganha `levelDetail`
- Modify: `app/progresso/page.tsx:49-60` (card de nível com XP + "o que falta")
- Test: `tests/unit/level.test.ts`

**Interfaces:**
- Produces: `computeLevelProgress(input: { level: string; wordsConsolidated: number; avgFluency: number | null; xpTotal: number }): { code: string; label: string; percent: number; missing: string | null }` — Iniciante→B1 exige 50 consolidadas E fluência ≥5; B1→Avançado exige 150 consolidadas E fluência ≥7; percent = 70% progresso de consolidadas + 30% de fluência (0 quando não há fluência medida — e `missing` explica).

- [ ] **Step 1: Teste**

```ts
// tests/unit/level.test.ts
import { describe, expect, it } from "vitest";
import { computeLevelProgress } from "@/lib/learning/level";

describe("computeLevelProgress", () => {
  it("nunca inventa percentual sem fluência medida", () => {
    const detail = computeLevelProgress({ level: "Iniciante", wordsConsolidated: 10, avgFluency: null, xpTotal: 0 });
    expect(detail.percent).toBeGreaterThan(0);
    expect(detail.missing).toContain("Conclua uma conversa");
  });

  it("percentual cresce com consolidadas e fluência", () => {
    const low = computeLevelProgress({ level: "Iniciante", wordsConsolidated: 10, avgFluency: 4, xpTotal: 0 });
    const high = computeLevelProgress({ level: "Iniciante", wordsConsolidated: 40, avgFluency: 6, xpTotal: 0 });
    expect(high.percent).toBeGreaterThan(low.percent);
  });

  it("B1 com meta de Avançado cumprida reporta completo", () => {
    const detail = computeLevelProgress({ level: "Intermediário (B1)", wordsConsolidated: 150, avgFluency: 7, xpTotal: 0 });
    expect(detail.percent).toBe(100);
    expect(detail.missing).toBeNull();
  });
});
```

- [ ] **Step 2: Implementar**

```ts
// lib/learning/level.ts
export type LevelDetail = { code: string; label: string; percent: number; missing: string | null };

const STAGE_TARGETS: Record<string, { next: string; code: string; consolidated: number; fluency: number }> = {
  "Iniciante": { next: "Intermediário (B1)", code: "A2→B1", consolidated: 50, fluency: 5 },
  "Intermediário (B1)": { next: "Avançado", code: "B1→C1", consolidated: 150, fluency: 7 },
  "Avançado": { next: "Avançado", code: "C1", consolidated: 300, fluency: 9 }
};

export function computeLevelProgress(input: { level: string; wordsConsolidated: number; avgFluency: number | null; xpTotal: number }): LevelDetail {
  const stage = STAGE_TARGETS[input.level] ?? STAGE_TARGETS["Iniciante"];
  const consolidatedRatio = Math.min(1, input.wordsConsolidated / stage.consolidated);
  if (input.avgFluency === null || input.avgFluency === undefined) {
    return {
      code: stage.code,
      label: stage.next,
      percent: Math.round(consolidatedRatio * 70),
      missing: "Conclua uma conversa para medir sua fluência."
    };
  }
  const fluencyRatio = Math.min(1, input.avgFluency / stage.fluency);
  const percent = input.wordsConsolidated >= stage.consolidated && input.avgFluency >= stage.fluency
    ? 100
    : Math.round((consolidatedRatio * 0.7 + fluencyRatio * 0.3) * 100);
  const missingWords = Math.max(0, stage.consolidated - input.wordsConsolidated);
  const missing = percent >= 100
    ? null
    : missingWords > 0
      ? `Faltam ~${missingWords} palavra${missingWords === 1 ? "" : "s"} consolidada${missingWords === 1 ? "" : "s"} para ${stage.next}.`
      : `Suba a fluência média para ${stage.fluency}/10 para ${stage.next}.`;
  return { code: stage.code, label: stage.next, percent, missing };
}
```

Em `app/progresso/page.tsx`: o card de nível (`:50-59`) passa a renderizar `progress.levelDetail.percent`, o texto `missing` como rodapé e o XP total (`progress.xpTotal` novo no payload de `progress.ts`, lido de `users.xp_total`) como Pill "N XP". **Apagar** a função `levelProgress` e seu uso.

- [ ] **Step 3: Verde + QA**

Run: `npx vitest run tests/unit/level.test.ts && npm run typecheck && npm run build`
QA: com fixture de 20 consolidadas e fluência 6 → barra ~meio e texto de faltas; usuário sem conversa → rodapé pede conversa.

- [ ] **Step 4: Commit**

```bash
git add lib/learning/level.ts lib/learning/progress.ts app/progresso/page.tsx tests/unit/level.test.ts
git commit -m "feat(progresso): nível real de domínio substitui barra de progresso fake"
```

---

### Task 4: Gráficos de evolução no Progresso

**Files:**
- Create: `components/MiniChart.tsx`
- Modify: `lib/learning/progress.ts` — payload `charts: { fluency: Array<{ date: string; value: number }>; weeklyWords: Array<{ label: string; value: number }> }` (fluência dos `daily_feedbacks` dos últimos 30 dias; palavras novas por semana, 8 semanas, usando `first_used_at` no fuso de `tz.ts`)
- Modify: `app/progresso/page.tsx` (duas seções novas)
- Test: `tests/unit/mini-chart.test.ts`

**Interfaces:**
- Produces: `chartPoints(values: number[], width: number, height: number): string` — string `x,y x,y …` para o `points` de um `<polyline>` (0→esquerda/baixo, máximo→direita/topo; um único ponto rende linha plana no meio).
- Produces: `components/MiniChart` — props `{ values: number[]; labels?: string[]; ariaLabel: string; tone?: "primary" | "info" }`.

- [ ] **Step 1: Teste**

```ts
// tests/unit/mini-chart.test.ts
import { describe, expect, it } from "vitest";
import { chartPoints } from "@/components/MiniChart";

describe("chartPoints", () => {
  it("mapeia mínimo→baixo e máximo→topo", () => {
    const points = chartPoints([0, 10], 100, 50);
    expect(points).toBe("0,50 100,0");
  });

  it("um único valor rende linha no meio", () => {
    expect(chartPoints([7], 100, 50)).toBe("0,25 100,25");
  });

  it("sem valores devolve string vazia", () => {
    expect(chartPoints([], 100, 50)).toBe("");
  });
});
```

- [ ] **Step 2: Implementar**

```tsx
// components/MiniChart.tsx
export function chartPoints(values: number[], width: number, height: number) {
  if (!values.length) return "";
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min;
  if (values.length === 1 || range === 0) {
    const y = height / 2;
    return `0,${y} ${width},${y}`;
  }
  return values
    .map((value, index) => {
      const x = Math.round((index / (values.length - 1)) * width);
      const y = Math.round(height - ((value - min) / range) * height);
      return `${x},${y}`;
    })
    .join(" ");
}

type MiniChartProps = { values: number[]; labels?: string[]; ariaLabel: string; tone?: "primary" | "info" };

export function MiniChart({ values, labels, ariaLabel, tone = "primary" }: MiniChartProps) {
  const width = 280;
  const height = 72;
  return <figure className="mini-chart" role="img" aria-label={ariaLabel}>
    <svg viewBox={`0 0 ${width} ${height + 18}`} preserveAspectRatio="none">
      <polyline
        className={`mini-chart-line ${tone}`}
        fill="none"
        points={chartPoints(values, width, height)}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={`translate(0 6)`}
      />
    </svg>
    {labels ? <figcaption>{labels[0]} → {labels[labels.length - 1]}</figcaption> : null}
  </figure>;
}
```

CSS: `.mini-chart-line.primary { stroke: var(--section); } .mini-chart-line.info { stroke: #315b94; } .mini-chart figcaption { color: var(--muted); font-size: 12px; }`.

Em `app/progresso/page.tsx`, após o MetricGrid:

```tsx
      {progress.charts.fluency.length > 0 ? (
        <section className="section">
          <h2 className="section-title">Fluidez — últimos 30 dias</h2>
          <MiniChart ariaLabel="Gráfico de fluência dos últimos 30 dias" labels={progress.charts.fluency.map((point) => point.date)} tone="primary" values={progress.charts.fluency.map((point) => point.value)} />
        </section>
      ) : null}
      {progress.charts.weeklyWords.some((week) => week.value > 0) ? (
        <section className="section">
          <h2 className="section-title">Palavras novas por semana</h2>
          <MiniChart ariaLabel="Palavras novas por semana nas últimas 8 semanas" labels={progress.charts.weeklyWords.map((week) => week.label)} tone="info" values={progress.charts.weeklyWords.map((week) => week.value)} />
        </section>
      ) : null}
```

- [ ] **Step 3: Verde + QA**

Run: `npx vitest run tests/unit/mini-chart.test.ts && npm run typecheck && npm run build`
QA: usuário com 3+ feedbacks vê linha de fluência; semanas sem palavras rendem linha plana (não erro).

- [ ] **Step 4: Commit**

```bash
git add components/MiniChart.tsx lib/learning/progress.ts app/progresso/page.tsx app/globals.css tests/unit/mini-chart.test.ts
git commit -m "feat(progresso): gráficos de fluência e vocabulário semanal"
```

---

### Task 5: Calendário em heatmap + streak no mês

**Files:**
- Modify: `lib/learning/feedback.ts` (`getCalendarData` — cada `day` ganha `intensity: 0..4` por minutos praticados no dia: 0 / <10 / <20 / <40 / ≥40, somando `duration_seconds` de conversas + sessões de flashcards do dia, no fuso de `tz.ts`) e `streak: number` (do serviço `syncStreakForUser`)
- Modify: `app/calendario/page.tsx:51-73` (classe de calor + chip de streak no header do mês)
- Modify: `app/globals.css`

**Interfaces:**
- Classe CSS `heat-{0..4}` nos `.calendar-day`; legenda "menos → mais".

- [ ] **Step 1: CSS**

```css
/* === Heatmap do calendário === */
.calendar-day.heat-1 { background: color-mix(in srgb, var(--section) 15%, #fff); }
.calendar-day.heat-2 { background: color-mix(in srgb, var(--section) 32%, #fff); }
.calendar-day.heat-3 { background: color-mix(in srgb, var(--section) 55%, #fff); }
.calendar-day.heat-4 { background: var(--section); color: var(--section-text); }
.calendar-heat-legend { display: flex; gap: 6px; align-items: center; justify-content: flex-end; margin-top: 10px; color: var(--muted); font-size: 12px; }
.calendar-heat-legend span { width: 14px; height: 14px; border-radius: 4px; border: 1px solid var(--line); }
```

- [ ] **Step 2: Render**

Em `app/calendario/page.tsx`, no `className` do dia (`:53-59`) acrescentar `day.intensity > 0 ? \`heat-${day.intensity}\` : ""`; adicionar o chip no header do mês (`:34-36`): `<Pill tone="primary"><Flame size={16}/> {calendar.streak} dias</Pill>`; e a legenda abaixo do grid:

```tsx
        <div className="calendar-heat-legend" aria-hidden="true">
          menos <span /><span /><span /><span /> mais
        </div>
```

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run build`
QA: dia com conversa longa pinta mais forte que dia com treino curto; streak aparece no header; navegação de mês mantém cores.

- [ ] **Step 4: Commit**

```bash
git add lib/learning/feedback.ts app/calendario/page.tsx app/globals.css
git commit -m "feat(progresso): calendário em heatmap com streak do mês"
```

---

### Task 6: Onboarding em wizard + "Perfil pronto!"

**Files:**
- Create: `components/OnboardingWizard.tsx`
- Modify: `app/onboarding/page.tsx` (renderiza o wizard no lugar do formulário único)
- Modify: `components/OnboardingForm.tsx` — **refactor**: o estado e a submissão existentes (nome, idioma, nível, objetivo, estilo de correção, switches; `OnboardingForm.tsx:128-294`) são preservados; o JSX é dividido em 3 passos dentro de `OnboardingWizard` que controla `step: 1|2|3` + a tela final.

**Estrutura do wizard:**
- Passo 1 "Você e o idioma": nome + idioma + nível. Barra de progresso real (`step/3`) no topo.
- Passo 2 "Seu objetivo": goal + estilo de correção.
- Passo 3 "Preferências": os 3 switches + resumo das escolhas + botão "Salvar e continuar" (submissão existente).
- Tela final "Perfil pronto! 🎉": `playSound("achievement")` + `burstConfetti` + mascote; CTA primário "Fazer minha primeira conversa" (`POST /api/conversations/start` com `{ mode: "free_conversation", title: "Conversa livre" }` → `router.push(data.redirectTo)`) e secundário "Explorar o app" (`router.push("/")`).

**Interfaces:**
- `OnboardingWizard` recebe o mesmo `redirectTo`/`mode` da página e delega a validação de cada passo: botão "Continuar" desabilitado enquanto o passo corrente tiver campo obrigatório vazio (mesmas regras atuais).

- [ ] **Step 1: Refactor** — extrair o estado do formulário para o wizard manter compat: `<OnboardingWizard fields={…} setField={…} onSubmit={…} mode={…} redirectTo={…} />`; cada passo é o bloco JSX correspondente movido sem alteração de markup (classes `choice-card`, `level-pills`, switches idênticas).

- [ ] **Step 2: Tela final**

```tsx
      {done ? <section className="section onboarding-celebration">
        <div className="flashcard-trophy celebrate"><PartyPopper /></div>
        <h1 className="title">Perfil pronto, {firstName}! 🎉</h1>
        <p className="subtitle">Em 1 minuto você faz sua primeira conversa — a IA ajusta o nível a você.</p>
        <button className="green-button full-button" disabled={starting} onClick={() => void startFirstConversation()} type="button">{starting ? <Loader2 className="spin" /> : <Mic />} Fazer minha primeira conversa</button>
        <Link className="outline-button full-button" href="/">Explorar o app</Link>
      </section> : /* …passos… */}
```

`startFirstConversation` segue o padrão de `confirmConversationStart` (`HomeDashboard.tsx:116-136`).

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run build`
QA: fluxo completo de conta nova — 3 passos, nada quebra a validação atual, tela final toca festa e cria conversa de verdade.

- [ ] **Step 4: Commit**

```bash
git add components/OnboardingWizard.tsx components/OnboardingForm.tsx app/onboarding/page.tsx
git commit -m "feat(progresso): onboarding em 3 passos com celebração de perfil pronto"
```

---

### Task 7: Espera com graça no preparo das palavras novas

**Files:**
- Create: `components/PreparingCards.tsx`
- Modify: `components/NewWordsTrainer.tsx` — estado `preparing` (`:89`, usado em `enterPreparation`/`pollForDeck`) renderiza `<PreparingCards />` no lugar do botão com label ("Preparando suas frases...", `:529-531`)

**Interfaces:**
- `PreparingCards` — props `{ languageName: string }`. Três skeleton-cards com `shimmer` (classe existente) + dica rotativa a cada 2,5s (array fixo de 5 dicas genéricas de aprendizado) + "Isso costuma levar até 1 minuto."

- [ ] **Step 1: Implementar**

```tsx
// components/PreparingCards.tsx
"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

const TIPS = [
  "Falar de mais assuntos Fixa menos que revisar pouco e sempre.",
  "Dizer a tradução em voz alta antes de digitar aumenta a retenção.",
  "Errar faz parte: cada erro ajusta quando a palavra volta a aparecer.",
  "Palavras usadas em conversa grudam mais que palavras de lista.",
  "Cinco minutos por dia vencem uma hora por semana."
];

export function PreparingCards({ languageName }: { languageName: string }) {
  const [tip, setTip] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTip((current) => (current + 1) % TIPS.length), 2500);
    return () => clearInterval(timer);
  }, []);

  return <section className="section preparing-cards" aria-live="polite" aria-label="Preparando suas frases">
    <div className="skeleton skeleton-card" />
    <div className="skeleton skeleton-line" />
    <div className="skeleton skeleton-line" style={{ width: "70%" }} />
    <p className="row-meta"><Sparkles size={14} aria-hidden="true" /> {TIPS[tip]}</p>
    <p className="row-meta">A IA está escolhendo palavras do seu nível e montando frases em {languageName}. Isso costuma levar até 1 minuto.</p>
  </section>;
}
```

CSS: `.preparing-cards { display: grid; gap: 12px; }`.

- [ ] **Step 2: Integrar + verificar**

No JSX do intro (`NewWordsTrainer.tsx:520-533`): quando `preparing`, renderizar `<PreparingCards languageName={languageName} />` e desabilitar o bloco de escolha (já desabilita via `disabled={busy || preparing}`). Run: `npm run typecheck && npm run build`. QA: iniciar sessão → skeleton + dicas rotativas até o deck abrir.

- [ ] **Step 3: Commit**

```bash
git add components/PreparingCards.tsx components/NewWordsTrainer.tsx app/globals.css
git commit -m "feat(progresso): espera do deck de palavras com dicas e skeleton"
```

---

### Task 8: Analytics mínimo + instrumentação de CTA

**Files:**
- Create: `scripts/analytics-report.mjs`
- Create: `docs/ANALYTICS_ENGAJAMENTO.md`
- Modify: `components/StartFlashcardsWithWords.tsx` + CTAs de fim de sessão (evento `cta_clicked` via `fetch("/api/events", { method: "POST", keepalive: true, body: JSON.stringify({ event_name: "cta_clicked", payload: { cta: "…" } }) })` — a rota `app/api/events/route.ts` já existe)

**Interfaces:**
- `node scripts/analytics-report.mjs --env .env.local` imprime: DAU/WAU (últimos 28d, usuários distintos com qualquer evento/sessão por dia), retenção D1/D7 (proxy: 2º/7º dia com atividade após o 1º), taxa de conclusão por modalidade (concluídas vs abandonadas), distribuição de streak (`users.current_streak`), opt-in de push (`push_opted_in` vs usuários), CTR dos CTAs (`cta_clicked` por `cta`).

- [ ] **Step 1: Script** — usa o admin client Supabase existente (`lib/supabase/admin.ts` via import direto de `@supabase/supabase-js` com `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE` do `--env`, padrão dos scripts de QA como `scripts/qa-fixture.mjs`); SQL via `.select()` + agregação em memória (base pequena). Estrutura:

```js
// scripts/analytics-report.mjs (esqueleto executável)
// 1. Carrega env do --env (mesmo parser dos scripts de QA).
// 2. Busca app_events (últimos 60d), practice_sessions, users, push_subscriptions.
// 3. Agrega em memória:
//    - dailyActive: Set(user:dayKey) de eventos+sessões (dayKey por fuso São Paulo, Intl).
//    - retention: para cada usuário, 1º dia ativo D0; D1 = ativo em D0+1; D7 = ativo em D0+7.
//    - completion: por type, count(status=completed) / count(status in (completed, abandoned)).
//    - streaks: histograma de users.current_streak (0, 1-6, 7-29, 30+).
//    - cta: Counter de payload->>cta em cta_clicked.
// 4. Imprime tabela Markdown com os números e a janela analisada.
```

(Este é o único item do plano onde o passo descreve a implementação em vez de incluí-la integralmente: o script é agregação em memória de 4 selects, sem risco de contrato — mantê-lo enxuto e legível faz parte do entregável. Rodar `node scripts/analytics-report.mjs --env .env.local` como verificação final.)

- [ ] **Step 2: Instrumentar CTAs** — em `StartFlashcardsWithWords.start()` (após sucesso) e nos links de "Usar palavras em conversa"/"Praticar próximo tema", disparar o beacon `cta_clicked` com `cta: "review_cards" | "chat_from_flashcards" | "next_topic" | "resumo_review"`.

- [ ] **Step 3: Doc** — `docs/ANALYTICS_ENGAJAMENTO.md` com as definições acima (fórmulas de cada métrica e a meta de cada uma, copiadas da tabela da seção 6 do estudo).

- [ ] **Step 4: Verificar + commit**

Run: `node scripts/analytics-report.mjs --env .env.local` → imprime relatório sem erro. `npm run lint && npm run typecheck`.

```bash
git add scripts/analytics-report.mjs docs/ANALYTICS_ENGAJAMENTO.md components/StartFlashcardsWithWords.tsx
git commit -m "feat(progresso): analytics de retenção e instrumentação de CTAs"
```

---

### Task 9: Release da fase

- [ ] **Step 1:** `npm run supabase:apply-schema` (0009) + smoke.
- [ ] **Step 2:** bump `public/sw.js` → `ai-fluency-shell-v17`.
- [ ] **Step 3:** `npm run lint && npm run typecheck && npm run test:unit && npm run build` (+ `test:release` ritual).

```bash
git add public/sw.js
git commit -m "chore(pwa): cache shell v17 (progresso)"
git push
```

## Critérios de aceite do plano

1. XP é premiado uma única vez por evento (sessão/missão/conquista), sempre server-side, e sobrevive a falhas sem quebrar a sessão.
2. A barra de nível reflete domínio real (consolidadas + fluência), mostra "o que falta", e `levelProgress()` não existe mais no código.
3. Progresso tem 2 gráficos honestos (escondem-se sem dado, não inventam linha).
4. Calendário pinta intensidade por minutos praticados e mostra a streak do mês.
5. Onboarding novo termina em festa com CTA de primeira conversa funcional.
6. A espera do deck mostra skeleton + dicas em vez de label estático.
7. `node scripts/analytics-report.mjs` produz relatório de retenção/conclusão/streak/CTR.
8. `CACHE_NAME` v17; release subset verde.
