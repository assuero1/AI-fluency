# Plano 2 — Hábito (P1): streak robusta, meta diária, missões, conquistas, loops e push

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar o laço do hábito: streak persistida com freeze e marcos (contando as 3 modalidades), meta diária visível, missões diárias, conquistas, badge de fila na navegação, notificações web push anti-quebra de streak — e corrigir as fundações de datas (bug UTC) de que essas mecânicas dependem.

**Architecture:** Uma migração Supabase aditiva (colunas de streak/meta em `users`, tabelas `engagement_achievements` e `push_subscriptions`). Toda a lógica é determinística e server-side (`lib/learning/streak.ts`, `quests.ts`, `achievements.ts`), avaliada a partir de dados que o app já grava (conversas, `practice_sessions`, eventos `new_words_session_completed`) — sem novo rastreamento. O push usa `web-push` (VAPID) com agendador via endpoint `tick` protegido, chamado por cron do EasyPanel.

**Tech Stack:** Supabase/Postgres (migração idempotente), Next.js route handlers, Web Push (VAPID), Service Worker handlers novos.

**Spec:** [docs/ESTUDO_ENGAJAMENTO_RETENCAO.md](../../ESTUDO_ENGAJAMENTO_RETENCAO.md) — seção 4, itens R5–R10 (Fase 2 do roadmap). **Pré-requisito:** Plano 1 concluído (o push reutiliza o som/celebração; os hooks de conclusão já existem).

## Global Constraints

- Migração **aditiva e idempotente** (padrão do repo: `if not exists` / reexecutável) — nada destrói dados existentes.
- Lembrete de push **nunca culpabiliza**: humor leve, no máximo "saudoso" (guarda do estudo, seção 4.5).
- Fuso horário do usuário manda em todos os dias/marcos; fallback único `America/Sao_Paulo` (elimina a mistura atual com `UTC`).
- Streak conta **conversa concluída, treino completo OU sessão de palavras novas completa** — a mesma regra em todas as telas (fim da inconsistência home/progresso).
- Sem punição: push é opt-in, fácil de desligar; freeze automático consome o direito, nunca inventa prática.
- Antes de cada push para o celular: bump do `CACHE_NAME` (v16 nesta fase — o `sw.js` muda).
- Novo runtime dep permitido nesta fase: `web-push` (servidor).

## Supersessões (decisões "deixa o melhor")

| Deixa de existir | Substituído por |
|---|---|
| Banner "Mantenha sua sequência" na Home (`HomeDashboard.tsx:164-186`) | Card "Hoje" (meta diária + streak + semana) que persiste após cumprir |
| Streak recalculada por request e divergente entre telas | Serviço único `lib/learning/streak.ts` persistido, 3 modalidades |
| Recompensa "simbólica" das missões (estudo R7) | Aí entra o XP do Plano 3 — missões já nascem com campo `xpAward` pronto |
| Cálculo de datas em UTC (`feedback.ts:658-660`, `progress.ts:249-267`) | `dateKeyInTimeZone` com fuso do usuário |

## File Structure

- Create: `lib/learning/tz.ts` — resolveTimeZone + dateKeyInTimeZone compartilhados
- Create: `supabase/migrations/0008_engagement_retention.sql`
- Create: `lib/learning/streak.ts` — serviço de streak (puro + persistência)
- Create: `lib/learning/daily-goal.ts` — progresso do dia
- Create: `lib/learning/quests.ts` — missões diárias determinísticas
- Create: `lib/learning/achievements.ts` — catálogo + avaliação + persistência
- Create: `components/HomeTodayCard.tsx`, `components/QuestList.tsx`, `components/MilestoneModal.tsx`, `components/AchievementToast.tsx`, `components/PushOptInCard.tsx`, `components/QueueBadge.tsx`
- Modify: `lib/learning/feedback.ts` (fuso), `lib/learning/progress.ts` (fuso + streak), `lib/learning/home.ts` (payload do dia), `lib/learning/practice-activity.ts` (export de dateKeyInTimeZone)
- Modify: `lib/learning/new-words.ts` (payload com `duration_seconds`)
- Modify: hooks de conclusão: `lib/learning/feedback.ts` (endConversation), `lib/learning/flashcards.ts` (completeFlashcardPractice), `lib/learning/new-words.ts` (complete)
- Modify: `components/HomeDashboard.tsx`, `components/BottomNav.tsx`, `components/ProfilePreferences.tsx`, `app/perfil/page.tsx`, `public/sw.js`, `app/manifest.ts`
- Create: `app/api/streak/ack-milestone/route.ts`, `app/api/achievements/route.ts`, `app/api/practice/queue-count/route.ts`, `app/api/notifications/subscribe/route.ts`, `app/api/notifications/unsubscribe/route.ts`, `app/api/notifications/tick/route.ts`
- Modify: `lib/supabase/tables.json` + `.env.example`
- Test: `tests/unit/tz.test.ts`, `tests/unit/streak.test.ts`, `tests/unit/daily-goal.test.ts`, `tests/unit/quests.test.ts`, `tests/unit/achievements.test.ts`

---

### Task 1: Fundação de fuso horário (`tz.ts`) e fix do bug UTC

**Files:**
- Create: `lib/learning/tz.ts`
- Modify: `lib/learning/practice-activity.ts:48-58` (exportar o helper em vez de duplicar)
- Modify: `lib/learning/feedback.ts` (`toDateKey` `:658-660`, `safeDateKey` `:663-667`, bucketing do calendário `:329-365`)
- Modify: `lib/learning/progress.ts` (`dateKey`/`monthKey` `:249-267`; fallbacks `?? "UTC"` em `:75`)
- Modify: `lib/learning/home.ts:95` (fallback)
- Test: `tests/unit/tz.test.ts`

**Interfaces:**
- Produces: `resolveTimeZone(value?: string): string` (fallback `America/Sao_Paulo`, valida com Intl) e `dateKeyInTimeZone(value: Date, timeZone: string): string` (`YYYY-MM-DD` local).

- [ ] **Step 1: Teste (falha primeiro)**

```ts
// tests/unit/tz.test.ts
import { describe, expect, it } from "vitest";
import { dateKeyInTimeZone, resolveTimeZone } from "@/lib/learning/tz";

describe("dateKeyInTimeZone", () => {
  it("22:00 em São Paulo pertence ao mesmo dia local", () => {
    // 2026-09-03T01:00Z == 2026-09-02 22:00 em São Paulo (UTC-3)
    expect(dateKeyInTimeZone(new Date("2026-09-03T01:00:00Z"), "America/Sao_Paulo")).toBe("2026-09-02");
  });

  it("o mesmo instante em Tóquio cai no dia seguinte", () => {
    expect(dateKeyInTimeZone(new Date("2026-09-03T01:00:00Z"), "Asia/Tokyo")).toBe("2026-09-03");
  });
});

describe("resolveTimeZone", () => {
  it("usa o fallback do app para valores vazios/inválidos", () => {
    expect(resolveTimeZone(undefined)).toBe("America/Sao_Paulo");
    expect(resolveTimeZone("Marte/Centro")).toBe("America/Sao_Paulo");
    expect(resolveTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});
```

Run: `npx vitest run tests/unit/tz.test.ts` → Expected: FAIL (módulo não existe)

- [ ] **Step 2: Implementar**

```ts
// lib/learning/tz.ts
export const DEFAULT_TIMEZONE = "America/Sao_Paulo";

export function resolveTimeZone(value?: string) {
  if (!value) return DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function dateKeyInTimeZone(value: Date, timeZone: string) {
  if (Number.isNaN(value.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}
```

Em `practice-activity.ts`: trocar o corpo do `dateKeyInTimeZone` local por `import { dateKeyInTimeZone } from "./tz"; export { dateKeyInTimeZone };` (apaga a duplicata).
Em `feedback.ts`: `toDateKey(value: string, timeZone = DEFAULT_TIMEZONE)` e `safeDateKey(value, timeZone)` passam a usar `dateKeyInTimeZone(new Date(value), timeZone)`; `saveDailyFeedback` recebe `timeZone` e o `finalizeConversation` o obtém de `resolveTimeZone((await getSessionUser()).fields.timezone)` (mesma sessão autenticada — padrão de `flashcards.ts:221`). Propagar para o bucketing mensal do calendário (`getCalendarData`) e para `progress.ts` (`dateKey`/`monthKey` recebem timeZone), substituindo todos os `?? "UTC"` por `resolveTimeZone(...)`.

- [ ] **Step 3: Rodar testes e ajustar fixtures**

Run: `npx vitest run tests/unit/tz.test.ts tests/unit/daily-feedback.test.ts`
Expected: `tz` PASS; `daily-feedback` pode falhar se fixtures assumirem UTC — atualizar as expectativas para o dia local de São Paulo (comportamento novo é o correto).

Run: `npm run test:unit && npm run typecheck`
Expected: verde

- [ ] **Step 4: Commit**

```bash
git add lib/learning/tz.ts lib/learning/practice-activity.ts lib/learning/feedback.ts lib/learning/progress.ts lib/learning/home.ts tests/unit/tz.test.ts tests/unit/daily-feedback.test.ts
git commit -m "fix(engajamento): datas de feedback e calendário no fuso do usuário (fim do bug UTC)"
```

---

### Task 2: Migração 0008 — colunas de streak/meta, conquistas e push

**Files:**
- Create: `supabase/migrations/0008_engagement_retention.sql`
- Modify: `lib/supabase/tables.json` (registrar `pushSubscriptions`, `engagementAchievements`)
- Modify: `.env.example` (VAPID + CRON_SECRET)

- [ ] **Step 1: SQL idempotente**

```sql
-- 0008: mecânicas de engajamento (streak, meta diária, conquistas, push).
-- Aditivo e idempotente.

alter table users add column if not exists current_streak integer not null default 0;
alter table users add column if not exists longest_streak integer not null default 0;
alter table users add column if not exists last_practice_day date;
alter table users add column if not exists streak_freeze_used_on date;
alter table users add column if not exists milestone_seen integer not null default 0;
alter table users add column if not exists daily_goal_minutes integer not null default 15;
alter table users add column if not exists reminder_hour integer;
alter table users add column if not exists last_reminder_sent date;

create table if not exists engagement_achievements (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  "Name" text,
  user_id uuid,
  achievement_key text not null,
  payload jsonb,
  unlocked_at timestamptz default now(),
  created_at timestamptz default now()
);
create unique index if not exists engagement_achievements_user_key
  on engagement_achievements (user_id, achievement_key);

create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  "Name" text,
  user_id uuid,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);

-- RLS no padrão do repo (dono vê/só escreve o que é dele)
alter table engagement_achievements enable row level security;
alter table push_subscriptions enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'engagement_achievements' and policyname = 'engagement_achievements_owner_all') then
    create policy engagement_achievements_owner_all on engagement_achievements
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'push_subscriptions' and policyname = 'push_subscriptions_owner_all') then
    create policy push_subscriptions_owner_all on push_subscriptions
      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
  end if;
end $$;
```

Em `lib/supabase/tables.json`, adicionar as chaves no padrão do arquivo:

```json
"pushSubscriptions": "push_subscriptions",
"engagementAchievements": "engagement_achievements"
```

Em `.env.example`:

```
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:contato@ai-fluency.app
NOTIFICATIONS_CRON_SECRET=
```

- [ ] **Step 2: Aplicar e validar**

Run: `npm run supabase:apply-schema` (conforme ritual do repo; validar com `npm run typecheck` depois de `tables.json`).
Expected: migração aplicada sem erro; reexecução idempotente.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0008_engagement_retention.sql lib/supabase/tables.json .env.example
git commit -m "feat(habito): migração de streak, meta diária, conquistas e push"
```

---

### Task 3: Serviço de streak (freeze + marcos) com testes

**Files:**
- Create: `lib/learning/streak.ts`
- Test: `tests/unit/streak.test.ts`

**Interfaces:**
- Produces (puro, testável): `computeStreakState(activeDays: string[], options: { today: string; previousStreak: number; longestStreak: number; freezeUsedOn?: string | null }): { streak: number; longestStreak: number; freezeConsumedOn: string | null; milestone: number | null }` — a caminhada começa em hoje (ou ontem se hoje ainda sem prática); UM único dia de falta é perdoado se ainda não houve freeze nos últimos 7 dias.
- Produces (I/O): `syncStreakForUser(userId: string): Promise<{ streak: number; practicedToday: boolean; milestone: number | null }>` — coleta os 3 sources (conversas concluídas via `listRecordsWhereAll("conversations", ...)`, treinos concluídos via `practiceSessions`, eventos `new_words_session_completed` via `appEvents`), monta day keys com `dateKeyInTimeZone` + `resolveTimeZone`, chama a função pura, persiste em `users` e devolve o marco cruzado.
- Produces: `STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365] as const`.

- [ ] **Step 1: Testes da função pura**

```ts
// tests/unit/streak.test.ts
import { describe, expect, it } from "vitest";
import { computeStreakState } from "@/lib/learning/streak";

const today = "2026-09-03";

function days(offsetsFromToday: number[]) {
  return offsetsFromToday.map((offset) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() - offset);
    return date.toISOString().slice(0, 10);
  });
}

describe("computeStreakState", () => {
  it("conta dias consecutivos incluindo hoje", () => {
    const state = computeStreakState(days([0, 1, 2]), { today, previousStreak: 0, longestStreak: 0 });
    expect(state.streak).toBe(3);
    expect(state.milestone).toBe(3);
  });

  it("hoje sem prática não quebra: conta de ontem para trás", () => {
    const state = computeStreakState(days([1, 2, 3]), { today, previousStreak: 3, longestStreak: 3 });
    expect(state.streak).toBe(3);
    expect(state.milestone).toBeNull();
  });

  it("uma falta é perdoada pelo freeze", () => {
    const state = computeStreakState(days([1, 2, 4, 5]), { today, previousStreak: 4, longestStreak: 4 });
    expect(state.streak).toBe(5);
    expect(state.freezeConsumedOn).toBe(days([3])[0]);
  });

  it("segunda falta quebra a sequência mesmo com freeze disponível", () => {
    const state = computeStreakState(days([1, 2, 5, 6]), { today, previousStreak: 2, longestStreak: 2 });
    expect(state.streak).toBe(2);
    expect(state.freezeConsumedOn).toBeNull();
  });

  it("freeze repetido em menos de 7 dias não é concedido", () => {
    const state = computeStreakState(days([1, 2, 4, 5]), { today, previousStreak: 4, longestStreak: 4, freezeUsedOn: days([2])[0] });
    expect(state.streak).toBe(2);
    expect(state.freezeConsumedOn).toBeNull();
  });

  it("marco só dispara quando é cruzado agora", () => {
    const state = computeStreakState(days([0, 1, 2, 3, 4, 5, 6]), { today, previousStreak: 6, longestStreak: 6 });
    expect(state.streak).toBe(7);
    expect(state.milestone).toBe(7);
    const again = computeStreakState(days([0, 1, 2, 3, 4, 5, 6]), { today, previousStreak: 7, longestStreak: 7 });
    expect(again.milestone).toBeNull();
  });
});
```

Run: `npx vitest run tests/unit/streak.test.ts` → Expected: FAIL

- [ ] **Step 2: Implementar**

```ts
// lib/learning/streak.ts
import { getTeableClient, type TeableRecord } from "@/lib/supabase/client";
import type { UserFields } from "@/lib/learning/profile";
import { dateKeyInTimeZone, resolveTimeZone } from "./tz";

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365] as const;
const FREEZE_COOLDOWN_DAYS = 7;

export type StreakState = { streak: number; longestStreak: number; freezeConsumedOn: string | null; milestone: number | null };

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function computeStreakState(
  activeDays: string[],
  options: { today: string; previousStreak: number; longestStreak: number; freezeUsedOn?: string | null }
): StreakState {
  const days = new Set(activeDays);
  const practicedToday = days.has(options.today);
  let cursor = practicedToday ? options.today : shiftDay(options.today, -1);
  let streak = 0;
  let freezeConsumedOn: string | null = null;
  const freezeAvailable = !options.freezeUsedOn
    || (Date.parse(options.today) - Date.parse(options.freezeUsedOn)) / 86_400_000 >= FREEZE_COOLDOWN_DAYS;

  for (let guard = 0; guard < 400; guard += 1) {
    if (days.has(cursor)) { streak += 1; cursor = shiftDay(cursor, -1); continue; }
    if (!freezeConsumedOn && freezeAvailable && streak > 0 && days.has(shiftDay(cursor, -1))) {
      freezeConsumedOn = cursor;
      cursor = shiftDay(cursor, -1);
      continue;
    }
    break;
  }

  const milestone = STREAK_MILESTONES.find((value) => options.previousStreak < value && streak >= value) ?? null;
  return { streak, longestStreak: Math.max(options.longestStreak, streak), freezeConsumedOn, milestone };
}
```

(Sobre `practicedToday === false`: a caminhada parte de ontem, então a streak exibida é a que está "em risco" — mesma semântica de `practice-activity.ts:22`.)

```ts
export async function syncStreakForUser(userId: string) {
  const client = getTeableClient();
  const [user] = await client.listRecordsWhere<UserFields>("users", "id", userId);
  const timeZone = resolveTimeZone(user?.fields.timezone);
  const now = new Date();
  const today = dateKeyInTimeZone(now, timeZone);

  const [conversations, sessions, events] = await Promise.all([
    client.listRecordsWhereAll<{ status?: string; ended_at?: string; started_at?: string }>("conversations", [{ field: "user_id", value: userId }, { field: "status", value: "completed" }]),
    client.listRecordsWhereAll<{ type?: string; status?: string; ended_at?: string; started_at?: string }>("practiceSessions", [{ field: "user_id", value: userId }, { field: "type", value: "flashcards" }, { field: "status", value: "completed" }]),
    client.listRecordsWhereAll<{ event_name?: string }>("appEvents", [{ field: "user_id", value: userId }, { field: "event_name", value: "new_words_session_completed" }])
  ]);

  const activeDays = [
    ...conversations.map((record) => record.fields.ended_at || record.fields.started_at),
    ...sessions.map((record) => record.fields.ended_at || record.fields.started_at),
    ...events.map((record) => (record as unknown as { created_at?: string }).created_at ?? "")
  ].filter(Boolean).map((value) => dateKeyInTimeZone(new Date(value), timeZone));

  const state = computeStreakState(activeDays, {
    today,
    previousStreak: Number(user?.fields.current_streak ?? 0),
    longestStreak: Number(user?.fields.longest_streak ?? 0),
    freezeUsedOn: user?.fields.streak_freeze_used_on ?? null
  });

  if (user) {
    await client.updateRecord<Partial<{ current_streak: number; longest_streak: number; last_practice_day: string; streak_freeze_used_on: string | null }>>("users", user.id, {
      current_streak: state.streak,
      longest_streak: state.longestStreak,
      last_practice_day: activeDays.includes(today) ? today : user.fields.last_practice_day ?? "",
      ...(state.freezeConsumedOn ? { streak_freeze_used_on: state.freezeConsumedOn } : {})
    });
    if (state.milestone) {
      await client.createEvent(userId, "streak_milestone_reached", { streak: state.streak, milestone: state.milestone });
    }
  }
  return { streak: state.streak, practicedToday: activeDays.includes(today), milestone: state.milestone };
}
```

(Assinaturas exatas de `listRecordsWhereAll`/`updateRecord` seguem os usos de `flashcards.ts:228-231` e `feedback.ts:128`; ajustar nomes de campo `UserFields` conforme `lib/learning/profile.ts`.)

- [ ] **Step 3: Verde**

Run: `npx vitest run tests/unit/streak.test.ts && npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add lib/learning/streak.ts tests/unit/streak.test.ts
git commit -m "feat(habito): serviço de streak persistida com freeze e marcos"
```

---

### Task 4: Integrar a streak em Home, Progresso e Chat (uma regra só)

**Files:**
- Modify: `lib/learning/home.ts:91-96` (trocar o `getPracticeActivity(conversations…)` por `syncStreakForUser(user.id)` + `getPracticeActivity` apenas para `activityDays`)
- Modify: `lib/learning/progress.ts:73-76` (idem — elimina a divergência: ambos passam a ter o MESMO número vindo de `users.current_streak`)
- Modify: `components/ChatConversation.tsx:592-593`, `app/chat/page.tsx:55` (continuam lendo o payload — só a fonte muda)
- Modify: `components/HomeDashboard.tsx` (recebe `streakMilestone?: number` no payload)

**Interfaces:**
- `HomeData.practice` passa a ser `{ streak: number; practicedToday: boolean; milestoneToCelebrate: number | null }` (`milestoneToCelebrate = current_streak >= milestone && milestone > users.milestone_seen ? milestone : null`).

- [ ] **Step 1: Trocar a fonte nas duas telas** — em `home.ts` e `progress.ts`, substituir o input da streak por:

```ts
  const streakState = await syncStreakForUser(user.id);
  const milestoneToCelebrate = STREAK_MILESTONES.find(
    (milestone) => streakState.streak >= milestone && milestone > Number(user.fields.milestone_seen ?? 0)
  ) ?? null;
```

`activityDays` (tira de 7 dias) continua do `getPracticeActivity` existente — apenas a streak numérica vem do serviço. Em `home.ts` o payload devolve `milestoneToCelebrate`.

- [ ] **Step 2: MilestoneModal na Home**

```tsx
// components/MilestoneModal.tsx
"use client";

import { useEffect } from "react";
import { Flame } from "lucide-react";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";

export function MilestoneModal({ streak, onAck }: { streak: number; onAck: () => void }) {
  useEffect(() => {
    playSound("achievement");
    vibrate("celebrate");
    burstConfetti({ particles: 150 });
  }, []);

  return <div className="modal-backdrop" role="presentation">
    <section aria-labelledby="milestone-title" aria-modal="true" className="confirmation-modal milestone-modal" role="dialog">
      <div className="flashcard-trophy celebrate"><Flame /></div>
      <h2 className="section-title" id="milestone-title">{streak} dias seguidos! 🔥</h2>
      <p className="row-meta">Sua constância está construindo fluência. Continue assim!</p>
      <button className="green-button full-button" onClick={onAck} type="button">Vamos nessa!</button>
    </section>
  </div>;
}
```

`onAck` dispara `fetch("/api/streak/ack-milestone", { method: "POST" })` (rota nova: marca `users.milestone_seen = users.current_streak` com `createEvent` `streak_milestone_acknowledged`) e fecha o modal.

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run test:unit && npm run build`
Expected: verde

QA manual: com fixture de 3 dias consecutivos, abrir Home → modal de marco; concluir treino E conversa no mesmo dia → a streak não muda de valor entre Home/Progresso/Chat.

- [ ] **Step 4: Commit**

```bash
git add lib/learning/home.ts lib/learning/progress.ts app/api/streak/ack-milestone/route.ts components/MilestoneModal.tsx components/HomeDashboard.tsx
git commit -m "feat(habito): streak única nas telas com celebração de marcos"
```

---

### Task 5: Meta diária + card "Hoje" (substitui o banner)

**Files:**
- Create: `lib/learning/daily-goal.ts`
- Create: `components/HomeTodayCard.tsx`
- Modify: `lib/learning/home.ts` (payload `today: { goalMinutes, minutesToday, complete, weekConversations, weekConversationGoal }`)
- Modify: `lib/learning/new-words.ts` (evento de conclusão ganha `duration_seconds`)
- Modify: `app/api/preferences/route.ts:13-14` (aceitar `dailyGoalMinutes`)
- Modify: `components/HomeDashboard.tsx:164-186` (banner fora; card novo entra)
- Modify: `components/ProfilePreferences.tsx` (select de meta: 5/15/30/60 min)
- Test: `tests/unit/daily-goal.test.ts`

**Interfaces:**
- Produces: `computeDailyGoalProgress(input: { goalMinutes: number; conversationSeconds: number; flashcardSeconds: number; newWordsSeconds: number }): { goalMinutes: number; minutesToday: number; percent: number; complete: boolean }`.
- Fontes dos segundos do dia (todas já persistidas): conversas concluídas hoje (`duration_seconds`, fuso de `tz.ts`), `practice_sessions` flashcards concluídos hoje, e o novo `duration_seconds` do evento `new_words_session_completed` (adicionado no `createEvent` do complete em `new-words.ts:603` com `Math.round((Date.now() - startedAt)/1000)`).
- `weekly_conversation_goal` finalmente vira UI: "Conversas esta semana: X/Y" no rodapé do card (contagem de conversas concluídas na semana local corrente).

- [ ] **Step 1: Teste**

```ts
// tests/unit/daily-goal.test.ts
import { describe, expect, it } from "vitest";
import { computeDailyGoalProgress } from "@/lib/learning/daily-goal";

describe("computeDailyGoalProgress", () => {
  it("soma as três modalidades em minutos", () => {
    const progress = computeDailyGoalProgress({ goalMinutes: 15, conversationSeconds: 420, flashcardSeconds: 240, newWordsSeconds: 120 });
    expect(progress.minutesToday).toBe(13);
    expect(progress.percent).toBe(87);
    expect(progress.complete).toBe(false);
  });

  it("completa quando atinge a meta", () => {
    const progress = computeDailyGoalProgress({ goalMinutes: 10, conversationSeconds: 620, flashcardSeconds: 0, newWordsSeconds: 0 });
    expect(progress.complete).toBe(true);
    expect(progress.percent).toBe(100);
  });

  it("nunca passa de 100% nem aceita meta absurda", () => {
    const progress = computeDailyGoalProgress({ goalMinutes: 99999, conversationSeconds: 3600, flashcardSeconds: 3600, newWordsSeconds: 3600 });
    expect(progress.percent).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Implementar `daily-goal.ts`**

```ts
// lib/learning/daily-goal.ts
export const DAILY_GOAL_OPTIONS = [5, 15, 30, 60] as const;

export function normalizeDailyGoalMinutes(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 15;
  const allowed = [...DAILY_GOAL_OPTIONS];
  return allowed.includes(number as (typeof allowed)[number]) ? number : 15;
}

export function computeDailyGoalProgress(input: { goalMinutes: number; conversationSeconds: number; flashcardSeconds: number; newWordsSeconds: number }) {
  const goalMinutes = Math.max(1, Math.round(Number(input.goalMinutes) || 15));
  const minutesToday = Math.round((input.conversationSeconds + input.flashcardSeconds + input.newWordsSeconds) / 60);
  const percent = Math.min(100, Math.round((minutesToday / goalMinutes) * 100));
  return { goalMinutes, minutesToday, percent, complete: minutesToday >= goalMinutes };
}
```

- [ ] **Step 3: `HomeTodayCard` + troca na Home**

```tsx
// components/HomeTodayCard.tsx
"use client";

import { Check, Flame, Mic } from "lucide-react";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";

type HomeTodayCardProps = {
  streak: number;
  practicedToday: boolean;
  goalMinutes: number;
  minutesToday: number;
  percent: number;
  complete: boolean;
  weekConversations: number;
  weekConversationGoal: number;
  onStartPractice: () => void;
};

export function HomeTodayCard(props: HomeTodayCardProps) {
  return <section className="section home-today" aria-label="Sua prática de hoje">
    <div className="top-row">
      <div className="row-title">Hoje</div>
      <span className="pill primary"><Flame size={16} aria-hidden="true" /> {formatPracticeStreak(props.streak)}</span>
    </div>
    <div className="word-big">{props.complete ? "Concluído! 🎉" : `${props.minutesToday} de ${props.goalMinutes} min`}</div>
    <div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.percent} aria-label={`${props.percent}% da meta de hoje`}>
      <span style={{ width: `${props.percent}%` }} />
    </div>
    <p className="row-meta">
      {props.complete
        ? "Meta de hoje batida. Cada dia conta para a sequência."
        : props.streak > 0
          ? `Uma prática rápida mantém sua sequência de ${props.streak} dias.`
          : "Reserve alguns minutos para começar o dia com o pé direito."}
    </p>
    {!props.complete ? <button className="green-button full-button" onClick={props.onStartPractice} type="button"><Mic /> Fazer minha prática</button> : null}
    <p className="row-meta">Conversas esta semana: {props.weekConversations}/{props.weekConversationGoal}</p>
    {!props.practicedToday && props.complete ? <p className="row-meta" style={{ color: "var(--primary)" }}><Check size={14} /> Você já praticou hoje — a sequência está garantida.</p> : null}
  </section>;
}
```

Em `HomeDashboard.tsx`: **remover** o bloco do banner `practice-reminder` (`:164-186`); renderizar `<HomeTodayCard … onStartPractice={() => setStartDraft({ mode: "free_conversation", title: "Conversa livre" })} />` no lugar. CSS leve: `.home-today { background: var(--section-soft); border-radius: 24px; padding: 20px; }` (padrão dos cards da seção). Em `ProfilePreferences`, select "Meta diária" gravando via PATCH `/api/preferences` `{ dailyGoalMinutes }` (rota clampada com `normalizeDailyGoalMinutes`).

- [ ] **Step 4: Verde + QA**

Run: `npm run test:unit && npm run typecheck && npm run build`
QA: com meta 15 min e 20 min praticados → "Concluído! 🎉" e botão some; alterar meta no Perfil reflete na Home.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/daily-goal.ts components/HomeTodayCard.tsx lib/learning/home.ts lib/learning/new-words.ts app/api/preferences/route.ts components/HomeDashboard.tsx components/ProfilePreferences.tsx tests/unit/daily-goal.test.ts
git commit -m "feat(habito): meta diária com card Hoje (substitui banner) e meta semanal de conversas visível"
```

---

### Task 6: Missões diárias (determinísticas por usuário+dia)

**Files:**
- Create: `lib/learning/quests.ts`
- Create: `components/QuestList.tsx`
- Modify: `lib/learning/home.ts` (payload `quests: Quest[]`)
- Modify: `components/HomeDashboard.tsx` (render abaixo do card Hoje)
- Test: `tests/unit/quests.test.ts`

**Interfaces:**
- Produces: `buildDailyQuests(input: { userId: string; dayStamp: string; conversationsToday: number; flashcardsToday: number; bestFlashcardScoreToday: number; newWordsSessionsToday: number; newWordsToday: number; minutesToday: number; queueSessionCardCount: number }): Quest[]`
- `Quest = { key: string; title: string; target: number; progress: number; complete: boolean; xpAward: number }` (`xpAward` reservado para o Plano 3; exibido a partir de lá).
- Seleção: catálogo elegível (exige dado possível) → `hashSeed(`${userId}:${dayStamp}:${key}`)` → top 3 determinísticas (mesma fórmula de `daily-queue.ts:91`).

- [ ] **Step 1: Teste**

```ts
// tests/unit/quests.test.ts
import { describe, expect, it } from "vitest";
import { buildDailyQuests } from "@/lib/learning/quests";

const base = { userId: "u1", dayStamp: "2026-09-03", conversationsToday: 0, flashcardsToday: 0, bestFlashcardScoreToday: 0, newWordsSessionsToday: 0, newWordsToday: 0, minutesToday: 0, queueSessionCardCount: 12 };

describe("buildDailyQuests", () => {
  it("é determinística para o mesmo usuário+dia", () => {
    expect(buildDailyQuests(base)).toEqual(buildDailyQuests(base));
  });

  it("devolve no máximo 3 missões com progresso coerente", () => {
    const quests = buildDailyQuests(base);
    expect(quests.length).toBeLessThanOrEqual(3);
    expect(quests.length).toBeGreaterThan(0);
    for (const quest of quests) {
      expect(quest.progress).toBeLessThanOrEqual(quest.target);
      expect(quest.complete).toBe(quest.progress >= quest.target);
    }
  });

  it("missão de conversa progride com conversas do dia", () => {
    const quests = buildDailyQuests({ ...base, conversationsToday: 1 });
    const conversationQuest = quests.find((quest) => quest.key === "finish_conversation");
    expect(conversationQuest?.complete ?? true).toBe(true);
  });
});
```

- [ ] **Step 2: Implementar catálogo + seleção**

```ts
// lib/learning/quests.ts
import { hashSeed } from "./spaced-repetition";

export type Quest = { key: string; title: string; target: number; progress: number; complete: boolean; xpAward: number };

type QuestDefinition = {
  key: string;
  title: string;
  target: number;
  xpAward: number;
  eligible: (input: DailyQuestInputs) => boolean;
  progress: (input: DailyQuestInputs) => number;
};

export type DailyQuestInputs = {
  userId: string;
  dayStamp: string;
  conversationsToday: number;
  flashcardsToday: number;
  bestFlashcardScoreToday: number;
  newWordsSessionsToday: number;
  newWordsToday: number;
  minutesToday: number;
  queueSessionCardCount: number;
};

const CATALOG: QuestDefinition[] = [
  { key: "finish_conversation", title: "Finalize 1 conversa", target: 1, xpAward: 10, eligible: () => true, progress: (input) => input.conversationsToday },
  { key: "finish_training", title: "Conclua 1 treino de cards", target: 1, xpAward: 10, eligible: (input) => input.queueSessionCardCount > 0 || input.flashcardsToday > 0, progress: (input) => input.flashcardsToday },
  { key: "sharp_training", title: "Tire 80%+ num treino", target: 80, xpAward: 15, eligible: () => true, progress: (input) => input.bestFlashcardScoreToday },
  { key: "learn_words", title: "Aprenda 3 palavras novas", target: 3, xpAward: 10, eligible: () => true, progress: (input) => input.newWordsToday },
  { key: "practice_minutes", title: "Pratique 15 minutos", target: 15, xpAward: 15, eligible: () => true, progress: (input) => Math.min(input.minutesToday, 15) },
  { key: "clear_queue", title: "Zere a fila de revisão de hoje", target: 1, xpAward: 15, eligible: (input) => input.queueSessionCardCount > 0, progress: (input) => (input.queueSessionCardCount === 0 && input.flashcardsToday > 0 ? 1 : 0) }
];

export function buildDailyQuests(input: DailyQuestInputs): Quest[] {
  return CATALOG
    .filter((definition) => definition.eligible(input))
    .map((definition) => ({ definition, sort: hashSeed(`${input.userId}:${input.dayStamp}:${definition.key}`) }))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, 3)
    .map(({ definition }) => {
      const progress = Math.min(definition.progress(input), definition.target);
      return { key: definition.key, title: definition.title, target: definition.target, progress, complete: progress >= definition.target, xpAward: definition.xpAward };
    });
}
```

(`hashSeed` é importado de `spaced-repetition.ts`, mesmo helper do `interleaveWords`.)

- [ ] **Step 3: `QuestList` + payload da Home**

```tsx
// components/QuestList.tsx
"use client";

import { Check, Target } from "lucide-react";

export function QuestList({ quests }: { quests: Array<{ key: string; title: string; target: number; progress: number; complete: boolean }> }) {
  if (!quests.length) return null;
  return <section className="section" aria-label="Missões de hoje">
    <h2 className="section-title">Missões de hoje</h2>
    <div className="row-list">
      {quests.map((quest) => <div className={`list-row${quest.complete ? " quest-complete" : ""}`} key={quest.key}>
        <span className={`icon-circle ${quest.complete ? "green" : ""}`}><Check aria-hidden="true" /></span>
        <div className="row-copy">
          <div className="row-title">{quest.title} {quest.complete ? "🎉" : ""}</div>
          <div className="row-meta">{quest.target > 1 ? `${quest.progress}/${quest.target}` : quest.complete ? "Concluída" : "Pendente"}</div>
        </div>
        <Target aria-hidden="true" />
      </div>)}
    </div>
  </section>;
}
```

Em `home.ts`, coletar os inputs (conversas/sessões/eventos de hoje já estão carregados lá; `minutesToday` do Task 5; `bestFlashcardScoreToday` do `focus.result.score` das sessões concluídas hoje; `queueSessionCardCount` do `dailyQueue` já presente) e devolver `buildDailyQuests(...)`; renderizar `<QuestList quests={home.quests} />` abaixo do card Hoje. CSS: `.quest-complete { opacity: .75; }`.

- [ ] **Step 4: Verde + QA**

Run: `npx vitest run tests/unit/quests.test.ts && npm run typecheck && npm run build`
QA: concluir a ação de uma missão → recarregar Home → missão com check; missões iguais em reloads do mesmo dia.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/quests.ts components/QuestList.tsx lib/learning/home.ts components/HomeDashboard.tsx tests/unit/quests.test.ts
git commit -m "feat(habito): missões diárias determinísticas na home"
```

---

### Task 7: Conquistas (catálogo, desbloqueio nos hooks, toast, página)

**Files:**
- Create: `lib/learning/achievements.ts`
- Create: `components/AchievementToast.tsx` (montado no `AppShell`)
- Create: `app/api/achievements/route.ts` (GET resumo)
- Create: `app/perfil/conquistas/page.tsx`
- Modify: hooks — `lib/learning/feedback.ts` (`finalizeConversation`, após o `createEvent` de `conversation_completed`), `lib/learning/flashcards.ts` (`completeFlashcardPractice`), `lib/learning/new-words.ts` (complete); as 3 respostas ganham `achievementsUnlocked: Array<{ key: string; title: string; description: string }>`; os clientes (`ChatConversation` antes do redirect, `NewWordsTrainer`, `FlashcardTrainer`) gravam em `sessionStorage["ai-fluency:unlocked-achievements"]`.
- Test: `tests/unit/achievements.test.ts`

**Interfaces:**
- Produces: `evaluateAchievements(userId: string): Promise<AchievementUnlock[]>` — snapshot de contadores (1 query por contador: conversas concluídas, sessões concluídas, palavras salvas, palavras consolidadas, streak atual via `users`), avalia o catálogo, insere os novos em `engagement_achievements` (índice único ignora duplicado com try/catch) e devolve só os desbloqueados agora.
- `ACHIEVEMENTS`: 15 definições `{ key, title, description, icon, check: (snapshot) => boolean }` — `first_conversation`, `conversations_10`, `conversations_50`, `words_25`, `words_200`, `consolidated_50`, `streak_3`, `streak_7`, `streak_30`, `training_score_90`, `new_words_25`, `senses_5`, `simulation_first` (evento `conversation_started` com modo simulation), `focus_practice` (1 prática de foco), `comeback` (prática após ≥7 dias parado).

- [ ] **Step 1: Teste do catálogo**

```ts
// tests/unit/achievements.test.ts
import { describe, expect, it } from "vitest";
import { ACHIEVEMENTS } from "@/lib/learning/achievements";

describe("ACHIEVEMENTS", () => {
  it("chaves únicas e descrição em toda conquista", () => {
    const keys = ACHIEVEMENTS.map((achievement) => achievement.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const achievement of ACHIEVEMENTS) {
      expect(achievement.title.length).toBeGreaterThan(0);
      expect(achievement.description.length).toBeGreaterThan(0);
    }
  });

  it("desbloqueia primeira conversa só quando existe", () => {
    const first = ACHIEVEMENTS.find((achievement) => achievement.key === "first_conversation")!;
    expect(first.check({ conversationsCompleted: 0 } as never)).toBe(false);
    expect(first.check({ conversationsCompleted: 1 } as never)).toBe(true);
  });
});
```

- [ ] **Step 2: Implementar catálogo + avaliação**

```ts
// lib/learning/achievements.ts
import { getTeableClient } from "@/lib/supabase/client";

export type AchievementSnapshot = {
  conversationsCompleted: number;
  flashcardSessionsCompleted: number;
  bestFlashcardScore: number;
  wordsSaved: number;
  wordsConsolidated: number;
  currentStreak: number;
  newWordsLearned: number;
  sensesAdded: number;
  startedSimulation: boolean;
  usedFocusPractice: boolean;
  daysSinceLastPractice: number;
};

export type AchievementDefinition = {
  key: string;
  title: string;
  description: string;
  check: (snapshot: AchievementSnapshot) => boolean;
};

export const ACHIEVEMENTS: AchievementDefinition[] = [
  { key: "first_conversation", title: "Primeira conversa", description: "Você concluiu sua primeira conversa com a IA.", check: (s) => s.conversationsCompleted >= 1 },
  { key: "conversations_10", title: "Dez conversas", description: "10 conversas concluídas. O hábito está pegando.", check: (s) => s.conversationsCompleted >= 10 },
  { key: "conversations_50", title: "Cinquenta conversas", description: "50 conversas concluídas. Isso é compromisso.", check: (s) => s.conversationsCompleted >= 50 },
  { key: "words_25", title: "25 palavras salvas", description: "Seu vocabulário real já tem 25 palavras.", check: (s) => s.wordsSaved >= 25 },
  { key: "words_200", title: "200 palavras salvas", description: "200 palavras do seu uso real salvas.", check: (s) => s.wordsSaved >= 200 },
  { key: "consolidated_50", title: "50 consolidadas", description: "50 palavras já estão na memória de longo prazo.", check: (s) => s.wordsConsolidated >= 50 },
  { key: "streak_3", title: "3 dias seguidos", description: "Três dias de prática consecutivos.", check: (s) => s.currentStreak >= 3 },
  { key: "streak_7", title: "Uma semana inteira", description: "7 dias seguidos de prática.", check: (s) => s.currentStreak >= 7 },
  { key: "streak_30", title: "Um mês de constância", description: "30 dias seguidos. Nível Duolingo de disciplina.", check: (s) => s.currentStreak >= 30 },
  { key: "training_score_90", title: "Treino impecável", description: "90% de acerto ou mais em um treino de cards.", check: (s) => s.bestFlashcardScore >= 90 },
  { key: "new_words_25", title: "25 palavras aprendidas", description: "25 palavras dominadas nas sessões de palavras novas.", check: (s) => s.newWordsLearned >= 25 },
  { key: "senses_5", title: "Cinco novos sentidos", description: "Você registrou 5 significados novos para palavras que já conhecia.", check: (s) => s.sensesAdded >= 5 },
  { key: "simulation_first", title: "Primeira simulação", description: "Você enfrentou sua primeira simulação de situação real.", check: (s) => s.startedSimulation },
  { key: "focus_practice", title: "No alvo", description: "Praticou um foco recomendado pela IA.", check: (s) => s.usedFocusPractice },
  { key: "comeback", title: "De volta ao jogo", description: "Voltou a praticar depois de uma pausa.", check: (s) => s.conversationsCompleted >= 1 && s.daysSinceLastPractice >= 7 }
];

export type AchievementUnlock = { key: string; title: string; description: string };

export async function evaluateAchievements(userId: string, partial: Partial<AchievementSnapshot> = {}): Promise<AchievementUnlock[]> {
  const client = getTeableClient();
  // Contadores complementares ao snapshot recebido do hook (cada hook já tem
  // parte dos dados em mãos e passa em `partial` para evitar re-query).
  const snapshot: AchievementSnapshot = { ...emptySnapshot(), ...partial };
  const owned = new Set(
    (await client.listRecordsWhereAll<{ achievement_key?: string }>("engagementAchievements", [{ field: "user_id", value: userId }]))
      .map((record) => record.fields.achievement_key)
  );
  const unlocked: AchievementUnlock[] = [];
  for (const definition of ACHIEVEMENTS) {
    if (owned.has(definition.key) || !definition.check(snapshot)) continue;
    unlocked.push({ key: definition.key, title: definition.title, description: definition.description });
    try {
      await client.createRecord("engagementAchievements", { user_id: userId, achievement_key: definition.key });
      await client.createEvent(userId, "achievement_unlocked", { achievement_key: definition.key });
    } catch { /* corrida inofensiva: índice único recusa duplicado */ }
  }
  return unlocked;
}

function emptySnapshot(): AchievementSnapshot {
  return { conversationsCompleted: 0, flashcardSessionsCompleted: 0, bestFlashcardScore: 0, wordsSaved: 0, wordsConsolidated: 0, currentStreak: 0, newWordsLearned: 0, sensesAdded: 0, startedSimulation: false, usedFocusPractice: false, daysSinceLastPractice: 0 };
}
```

(Nos hooks, o chamador passa em `partial` os contadores que já tem em mãos — ex.: o complete dos flashcards passa `bestFlashcardScore` — e `evaluateAchievements` consulta apenas o que falta.)

- [ ] **Step 3: Hooks + toast global**

Nos 3 hooks de conclusão, chamar `evaluateAchievements` (passando o que o hook já sabe: ex. flashcards passa `bestFlashcardScore`) e incluir `achievementsUnlocked` na resposta JSON. Nos 3 clientes, antes de mostrar o resultado/redirect:

```ts
if (data.achievementsUnlocked?.length) {
  sessionStorage.setItem("ai-fluency:unlocked-achievements", JSON.stringify(data.achievementsUnlocked));
}
```

`AchievementToast` (client, montado uma vez no `AppShell`): no mount + a cada 3s por 10s, lê e limpa a chave do sessionStorage; se houver conquistas, toca `playSound("achievement")` + `vibrate("celebrate")` e mostra cartão pop-in por 4s ("🏆 Conquista desbloqueada: {title}").

`app/perfil/conquistas/page.tsx` (server): lista `ACHIEVEMENTS` com estado via `listRecordsWhereAll("engagementAchievements")` do usuário — desbloqueadas com data, travadas em cinza com descrição. Link "Conquistas" na página do Perfil. `GET /api/achievements` devolve o mesmo resumo (para uso futuro do toast).

- [ ] **Step 4: Verde + QA**

Run: `npx vitest run tests/unit/achievements.test.ts && npm run typecheck && npm run build`
QA: concluir a 1ª conversa de um usuário novo → toast de "Primeira conversa" no resumo; página de conquistas reflete; repetir conclusão → sem toast duplicado.

- [ ] **Step 5: Commit**

```bash
git add lib/learning/achievements.ts components/AchievementToast.tsx app/api/achievements/route.ts app/perfil/conquistas/page.tsx lib/learning/feedback.ts lib/learning/flashcards.ts lib/learning/new-words.ts components/AppShell.tsx tests/unit/achievements.test.ts
git commit -m "feat(habito): conquistas com desbloqueio nos hooks e toast global"
```

---

### Task 8: Badge de fila pendente na BottomNav

**Files:**
- Create: `app/api/practice/queue-count/route.ts` (GET → `{ ok, dueCount, newCount }` reusando `getDailyQueueSummary()` de `flashcards.ts:417`)
- Modify: `components/BottomNav.tsx`
- Modify: `app/globals.css` (`.nav-badge`)

**Interfaces:**
- `BottomNav` passa a buscar `"/api/practice/queue-count"` no mount (abort em unmount, cache `sessionStorage["ai-fluency:queue-count"]` por 5 min) e mostra o total no item "Palavras".

- [ ] **Step 1: Rota**

```ts
// app/api/practice/queue-count/route.ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getDailyQueueSummary } from "@/lib/learning/flashcards";

export async function GET() {
  try {
    const dailyQueue = await getDailyQueueSummary();
    return jsonOk({ ok: true, dueCount: dailyQueue.dueCount, newCount: dailyQueue.newCount });
  } catch (error) { return handleApiError(error); }
}
```

- [ ] **Step 2: Nav com badge**

Em `BottomNav.tsx`, adicionar:

```tsx
  const [queueBadge, setQueueBadge] = useState(0);

  useEffect(() => {
    const cached = sessionStorage.getItem("ai-fluency:queue-count");
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { value: number; at: number };
        if (Date.now() - parsed.at < 5 * 60_000) setQueueBadge(parsed.value);
      } catch { /* cache inválido */ }
    }
    const controller = new AbortController();
    void fetch("/api/practice/queue-count", { signal: controller.signal })
      .then((response) => response.json() as Promise<{ ok?: boolean; dueCount?: number; newCount?: number }>)
      .then((data) => {
        if (!data.ok) return;
        const value = (data.dueCount ?? 0) + (data.newCount ?? 0);
        setQueueBadge(value);
        sessionStorage.setItem("ai-fluency:queue-count", JSON.stringify({ value, at: Date.now() }));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
```

No item "Palavras", renderizar o badge:

```tsx
          <Icon aria-hidden="true" />
          <span>{label}</span>
          {key === "palavras" && queueBadge > 0 ? <span className="nav-badge" aria-label={`${queueBadge} cards aguardando revisão`}>{queueBadge > 9 ? "9+" : queueBadge}</span> : null}
```

CSS: `.nav-badge { position: absolute; top: 2px; right: 50%; margin-right: -26px; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: #e0524a; color: #fff; font-size: 11px; font-weight: 800; display: grid; place-items: center; }` (`.nav-item` já é `position: relative` — conferir e ajustar offsets visuais).

- [ ] **Step 3: Verificar**

Run: `npm run typecheck && npm run build`
QA: com fila populada → badge vermelho no tab Palavras em todas as telas; fila zerada → sem badge.

- [ ] **Step 4: Commit**

```bash
git add app/api/practice/queue-count/route.ts components/BottomNav.tsx app/globals.css
git commit -m "feat(habito): badge de fila pendente na navegação"
```

---

### Task 9: Notificações web push (opt-in, tick, copy escalonada)

**Files:**
- Modify: `public/sw.js` (handlers `push` + `notificationclick`)
- Create: `app/api/notifications/subscribe/route.ts`, `app/api/notifications/unsubscribe/route.ts`, `app/api/notifications/tick/route.ts`
- Create: `components/PushOptInCard.tsx`
- Modify: `components/HomeDashboard.tsx` (card de opt-in contextual), `components/ProfilePreferences.tsx` (hora do lembrete + desligar), `app/manifest.ts`
- Modify: `package.json` (`web-push` dependency)
- Modify: `.env.local`/EasyPanel secrets (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NOTIFICATIONS_CRON_SECRET`)

**Decisão de infra (recomendada):** endpoint `tick` no próprio Next + cron do EasyPanel (`curl -H "x-cron-secret: …" https://…/api/notifications/tick` a cada hora). Entrada é inbound (não sofre o timeout do proxy reverso se o tick responder rápido); envios são limitados a 20/run e paginados por rodada. Alternativa documentada no plano B: Supabase pg_cron + Edge Function (útil se a rede da VPS degradar).

- [ ] **Step 1: Handlers no service worker**

```js
// public/sw.js — acrescentar
self.addEventListener("push", (event) => {
  let payload = { title: "AI Fluency", body: "Hora da prática de hoje!" };
  try { payload = { ...payload, ...event.data.json() }; } catch { /* payload cru */ }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "ai-fluency-reminder",
    data: { url: payload.url || "/" }
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).pathname.startsWith(target));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  }));
});
```

- [ ] **Step 2: Subscribe/unsubscribe**

```ts
// app/api/notifications/subscribe/route.ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getSessionUser } from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/supabase/client";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; reminderHour?: unknown };
    const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
    if (!endpoint || !p256dh || !auth) return jsonOk({ ok: false, error: "Assinatura inválida." }, { status: 422 });
    const user = await getSessionUser();
    const client = getTeableClient();
    const existing = await client.listRecordsWhereAll("pushSubscriptions", [{ field: "user_id", value: user.id }, { field: "endpoint", value: endpoint }]);
    if (!existing.length) {
      await client.createRecord("pushSubscriptions", { user_id: user.id, endpoint, p256dh, auth });
    }
    const reminderHour = Number(body.reminderHour);
    const patch: Record<string, unknown> = {};
    if (Number.isInteger(reminderHour) && reminderHour >= 0 && reminderHour <= 23) patch.reminder_hour = reminderHour;
    if (Object.keys(patch).length) await client.updateRecord("users", user.id, patch);
    await client.createEvent(user.id, "push_opted_in", { reminder_hour: reminderHour ?? null });
    return jsonOk({ ok: true });
  } catch (error) { return handleApiError(error); }
}
```

`unsubscribe` recebe `{ endpoint }` e deleta o registro (+ evento `push_opted_out`). (Verificar o método de delete disponível no client Supabase do repo; se não houver, marcar `p256dh = ""` e o tick ignora assinaturas sem chaves.)

- [ ] **Step 3: Tick (agendador)**

```ts
// app/api/notifications/tick/route.ts
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getTeableClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone, resolveTimeZone } from "@/lib/learning/tz";
import webpush from "web-push";

const BATCH = 20;

export async function POST(request: Request) {
  try {
    if (request.headers.get("x-cron-secret") !== process.env.NOTIFICATIONS_CRON_SECRET) {
      return jsonOk({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:contato@ai-fluency.app", process.env.VAPID_PUBLIC_KEY ?? "", process.env.VAPID_PRIVATE_KEY ?? "");
    const client = getTeableClient();
    const now = new Date();
    const users = await client.listRecordsWhereAll<{ timezone?: string; reminder_hour?: number; last_practice_day?: string; current_streak?: number; last_reminder_sent?: string }>("users", [{ field: "reminder_hour", value: now.getHours() }]);
    let sent = 0;
    for (const user of users) {
      if (sent >= BATCH) break;
      const timeZone = resolveTimeZone(user.fields.timezone);
      const today = dateKeyInTimeZone(now, timeZone);
      if (user.fields.last_practice_day === today) continue;              // já praticou: não perturba
      if (user.fields.last_reminder_sent === today) continue;             // 1 por dia, no máximo
      const streak = Number(user.fields.current_streak ?? 0);
      const { title, body } = streak > 0
        ? { title: `Sua sequência de ${streak} dia${streak === 1 ? "" : "s"} está em jogo 🔥`, body: "Uma prática rápida de 5 minutos mantém tudo no lugar." }
        : { title: "Que tal alguns minutos de prática?", body: "Suas palavras continuam te esperando por lá." };
      const subscriptions = await client.listRecordsWhereAll<{ endpoint?: string; p256dh?: string; auth?: string }>("pushSubscriptions", [{ field: "user_id", value: user.id }]);
      for (const subscription of subscriptions) {
        if (!subscription.fields.endpoint || !subscription.fields.p256dh) continue;
        try {
          await webpush.sendNotification(
            { endpoint: subscription.fields.endpoint, keys: { p256dh: subscription.fields.p256dh, auth: subscription.fields.auth ?? "" } },
            JSON.stringify({ title, body, url: "/" })
          );
          sent += 1;
        } catch { /* assinatura morta: limpa abaixo */ }
      }
      await client.updateRecord("users", user.id, { last_reminder_sent: today });
    }
    return jsonOk({ ok: true, sent });
  } catch (error) { return handleApiError(error); }
}
```

(Conferir o filtro de equality por `reminder_hour` no client do repo; se o wrapper não suportar filtro numérico, buscar todos os usuários com assinatura e filtrar em memória — a base é pequena.)

- [ ] **Step 4: Opt-in contextual + preferências**

`PushOptInCard` (client): exibido na Home **só quando** `home.completedSessions >= 2 && Notification.permission === "default"`. Botão "Quero o lembrete 🔔":

```ts
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!)
  });
  await fetch("/api/notifications/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...subscription.toJSON(), reminderHour: new Date().getHours() }) });
```

Copy do card: "Avisamos 1x por dia, só quando você ainda não praticou — e nunca mais que isso." Em `ProfilePreferences`: select de hora do lembrete (reenvia subscribe/patch) + botão "Desativar lembretes". `app/manifest.ts`: manter `standalone` (push não exige mudança). `urlBase64ToUint8Array` é helper inline de ~8 linhas (padrão web-push docs).

- [ ] **Step 5: Verificar**

Run: `npm run typecheck && npm run build`
QA em desktop Chrome (DevTools → Application → Push): subscribir, enviar payload de teste pelo Node (`webpush.sendNotification`), notificação aparece; clique abre `/`. Tick com secret errado → 401; com secret → 200 `{ sent }`; usuário que praticou hoje não recebe.

- [ ] **Step 6: Commit**

```bash
git add public/sw.js app/api/notifications components/PushOptInCard.tsx components/HomeDashboard.tsx components/ProfilePreferences.tsx package.json package-lock.json
git commit -m "feat(habito): web push anti-quebra de streak com opt-in e lembrete diário único"
```

---

### Task 10: Release da fase (migração + cache + verificação)

- [ ] **Step 1:** `npm run supabase:apply-schema` (se a Task 2 ainda não rodou em produção) e smoke: `npm run test:smoke`.
- [ ] **Step 2:** bump `public/sw.js` → `ai-fluency-shell-v16`.
- [ ] **Step 3:** `npm run lint && npm run typecheck && npm run test:unit && npm run build` (+ ritual `test:release` antes do deploy de verdade).

```bash
git add public/sw.js
git commit -m "chore(pwa): cache shell v16 (hábito)"
git push
```

## Critérios de aceite do plano

1. Streak com valor único em todas as telas, contando conversa + treino + palavras novas, persistida, com freeze (1 falta a cada 7 dias) e marcos celebrados (3/7/14/30…).
2. Datas de feedback/calendário no fuso do usuário (prática às 22h de São Paulo cai no dia 22h).
3. Card "Hoje" com meta diária editável substitui o banner antigo; `weekly_conversation_goal` visível.
4. 3 missões diárias determinísticas, completáveis com as modalidades existentes.
5. Conquistas desbloqueiam nos hooks, tocam toast, e têm página no Perfil — sem duplicatas (índice único).
6. Badge de fila na nav Palavras.
7. Push opt-in contextual, no máximo 1 lembrete/dia, nunca para quem já praticou, copy sem culpa; desligável no Perfil.
8. Migração idempotente aplicada; `CACHE_NAME` v16; release subset verde.
