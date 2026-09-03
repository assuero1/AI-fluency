// XP é a moeda única de progresso. Toda premiação é server-side (o cliente
// nunca "ganha" XP direto) e registrada em app_events via xp_awarded.
import { getTeableClient } from "@/lib/supabase/client";

export const XP_AMOUNTS = {
  conversation: 25,
  flashcards: 15,
  new_words: 20,
  quest: { base: 10 },
  achievement: 25
} as const;

type QuestLike = { key: string; complete: boolean; xpAward: number };

export function questsToAward(dayStamp: string, quests: QuestLike[], alreadyPaid: string[]) {
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
  const users = await client.listRecordsWhereAll<{ xp_total?: number }>("users", [{ field: "id", value: userId }]);
  const user = users[0];
  const total = Number(user?.fields.xp_total ?? 0) + amount;
  if (user) {
    await client.updateRecord<{ xp_total: number }>("users", user.id, { xp_total: total });
  }
  await client.createEvent(userId, "xp_awarded", { amount, reason });
  return total;
}

function parseQuestKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

// Paga o XP das missões concluídas no dia, uma única vez por missão+dia
// (chaves pagas vivem em users.quest_xp_keys).
export async function awardQuestXpIfNew(userId: string, dayStamp: string, quests: QuestLike[]) {
  const client = getTeableClient();
  const users = await client.listRecordsWhereAll<{ xp_total?: number; quest_xp_keys?: unknown }>("users", [{ field: "id", value: userId }]);
  const user = users[0];
  if (!user) return 0;
  const paid = parseQuestKeys(user.fields.quest_xp_keys);
  const awards = questsToAward(dayStamp, quests, paid);
  if (!awards.length) return 0;
  const amount = awards.reduce((sum, award) => sum + award.amount, 0);
  await client.updateRecord<Record<string, unknown>>("users", user.id, {
    quest_xp_keys: JSON.stringify([...paid, ...awards.map((award) => award.key)].slice(-400)),
    xp_total: Number(user.fields.xp_total ?? 0) + amount
  });
  await client.createEvent(userId, "xp_awarded", { amount, reason: "quests" });
  return amount;
}
