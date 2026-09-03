// Streak persistida do usuário: conversa concluída, treino completo OU sessão
// de palavras novas completa contam como prática do dia. Uma única falta pode
// ser perdoada pelo "congelamento" (1 a cada 7 dias) — perda evitada, nunca
// prática inventada.
import { getTeableClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone, resolveTimeZone } from "./tz";

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365] as const;
const FREEZE_COOLDOWN_DAYS = 7;
const WALK_GUARD = 400;

export type StreakState = {
  streak: number;
  longestStreak: number;
  freezeConsumedOn: string | null;
  milestone: number | null;
};

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
  // Sem prática hoje, a caminhada parte de ontem: a streak exibida é a que
  // está "em risco" (mesma semântica de practice-activity.ts).
  let cursor = practicedToday ? options.today : shiftDay(options.today, -1);
  let streak = 0;
  let freezeConsumedOn: string | null = null;
  const freezeAvailable = !options.freezeUsedOn
    || (Date.parse(`${options.today}T12:00:00Z`) - Date.parse(`${options.freezeUsedOn}T12:00:00Z`)) / 86_400_000 >= FREEZE_COOLDOWN_DAYS;

  for (let guard = 0; guard < WALK_GUARD; guard += 1) {
    if (days.has(cursor)) {
      streak += 1;
      cursor = shiftDay(cursor, -1);
      continue;
    }
    if (!freezeConsumedOn && freezeAvailable && streak > 0 && days.has(shiftDay(cursor, -1))) {
      // O dia congelado conta na sequência: é esse o propósito do freeze.
      freezeConsumedOn = cursor;
      streak += 1;
      cursor = shiftDay(cursor, -1);
      continue;
    }
    break;
  }

  const milestone = STREAK_MILESTONES.find((value) => options.previousStreak < value && streak >= value) ?? null;
  return { streak, longestStreak: Math.max(options.longestStreak, streak), freezeConsumedOn, milestone };
}

export type StreakSyncResult = {
  streak: number;
  practicedToday: boolean;
  milestone: number | null;
};

// Coleta as 3 modalidades em 2 tabelas (conversas concluídas + sessões de
// prática concluídas de qualquer tipo) e persiste o estado consolidado.
export async function syncStreakForUser(userId: string, options: { now?: Date; timeZone?: string } = {}): Promise<StreakSyncResult> {
  const client = getTeableClient();
  const now = options.now ?? new Date();
  const timeZone = resolveTimeZone(options.timeZone);
  const today = dateKeyInTimeZone(now, timeZone);

  const [userRecords, conversations, sessions] = await Promise.all([
    client.listRecordsWhereAll<{ current_streak?: number; longest_streak?: number; streak_freeze_used_on?: string | null; last_practice_day?: string | null }>("users", [{ field: "id", value: userId }]),
    client.listRecordsWhereAll<{ status?: string; ended_at?: string; started_at?: string }>("conversations", [
      { field: "user_id", value: userId },
      { field: "status", value: "completed" }
    ]),
    client.listRecordsWhereAll<{ status?: string; ended_at?: string; started_at?: string }>("practiceSessions", [
      { field: "user_id", value: userId },
      { field: "status", value: "completed" }
    ])
  ]);
  const user = userRecords[0];

  const activeDays = [
    ...conversations.map((record) => record.fields.ended_at || record.fields.started_at),
    ...sessions.map((record) => record.fields.ended_at || record.fields.started_at)
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => dateKeyInTimeZone(new Date(value), timeZone));

  const state = computeStreakState(activeDays, {
    today,
    previousStreak: Number(user?.fields.current_streak ?? 0),
    longestStreak: Number(user?.fields.longest_streak ?? 0),
    freezeUsedOn: user?.fields.streak_freeze_used_on ?? null
  });

  if (user) {
    await client.updateRecord<Record<string, unknown>>("users", user.id, {
      current_streak: state.streak,
      longest_streak: state.longestStreak,
      ...(activeDays.includes(today) ? { last_practice_day: today } : {}),
      ...(state.freezeConsumedOn ? { streak_freeze_used_on: state.freezeConsumedOn } : {})
    });
    if (state.milestone) {
      await client.createEvent(userId, "streak_milestone_reached", { streak: state.streak, milestone: state.milestone });
    }
  }

  return { streak: state.streak, practicedToday: activeDays.includes(today), milestone: state.milestone };
}
