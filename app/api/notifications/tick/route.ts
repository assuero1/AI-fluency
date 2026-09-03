import webpush from "web-push";
import { timingSafeEqual } from "node:crypto";
import { createHash } from "node:crypto";
import { handleApiError, jsonOk } from "@/lib/api/responses";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { createSupabaseTeableClient } from "@/lib/supabase/client";
import { dateKeyInTimeZone, resolveTimeZone } from "@/lib/learning/tz";

// Chamado 1x/hora pelo cron do EasyPanel (header x-cron-secret). Roda SEM
// sessão de usuário, por isso usa o client service-role (bypassa RLS).
// Regras: no máximo 1 lembrete/dia por usuário; NUNCA para quem já praticou
// hoje; envio na hora local preferida (users.reminder_hour); lote curto para
// responder rápido antes do timeout do proxy.
const BATCH_LIMIT = 20;

type UserRow = {
  id: string;
  fields: {
    timezone?: string;
    reminder_hour?: number;
    last_practice_day?: string | null;
    last_reminder_sent?: string | null;
    current_streak?: number;
  };
};

function localHour(date: Date, timeZone: string) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hour12: false }).format(date));
}

function copyFor(streak: number) {
  // Humor leve, nunca culpa (guarda do estudo de engajamento).
  return streak > 0
    ? { title: `Sua sequência de ${streak} dia${streak === 1 ? "" : "s"} está em jogo 🔥`, body: "Uma prática rápida de 5 minutos mantém tudo no lugar." }
    : { title: "Que tal alguns minutos de prática?", body: "Suas palavras continuam te esperando por lá." };
}

// Comparação em tempo constante (digests de mesmo tamanho) para o segredo que
// porta um endpoint de service-role.
function cronSecretMatches(presented: string | null) {
  const expected = process.env.NOTIFICATIONS_CRON_SECRET ?? "";
  if (!expected || !presented) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

export async function POST(request: Request) {
  try {
    if (!cronSecretMatches(request.headers.get("x-cron-secret"))) {
      return jsonOk({ ok: false, error: "unauthorized" }, { status: 401 });
    }
    const vapidPublic = process.env.VAPID_PUBLIC_KEY;
    const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
    if (!vapidPublic || !vapidPrivate) {
      return jsonOk({ ok: false, error: "Push não configurado (VAPID ausente)." }, { status: 503 });
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:contato@ai-fluency.app", vapidPublic, vapidPrivate);

    const client = createSupabaseTeableClient(createServiceRoleClient());
    const now = new Date();
    const users = (await client.listAllRecords<UserRow["fields"]>("users")) as unknown as Array<{ id: string; fields: UserRow["fields"] }>;
    const dueUsers = users.filter((user) => {
      if (!Number.isInteger(Number(user.fields.reminder_hour))) return false;
      if (Number(user.fields.reminder_hour) !== localHour(now, resolveTimeZone(user.fields.timezone))) return false;
      return true;
    });

    let sent = 0;
    for (const user of dueUsers) {
      if (sent >= BATCH_LIMIT) break;
      const timeZone = resolveTimeZone(user.fields.timezone);
      const today = dateKeyInTimeZone(now, timeZone);
      if (user.fields.last_practice_day === today) continue; // já praticou: não perturba
      if (user.fields.last_reminder_sent === today) continue; // 1 por dia, no máximo

      const subscriptions = await client.listRecordsWhereAll<{ endpoint?: string; p256dh?: string; auth?: string }>("pushSubscriptions", [
        { field: "user_id", value: user.id }
      ]);
      const deliverable = subscriptions.filter((subscription) => subscription.fields.endpoint && subscription.fields.p256dh);
      if (!deliverable.length) continue;

      const message = JSON.stringify({ ...copyFor(Number(user.fields.current_streak ?? 0)), url: "/" });
      for (const subscription of deliverable) {
        try {
          await webpush.sendNotification(
            { endpoint: subscription.fields.endpoint!, keys: { p256dh: subscription.fields.p256dh!, auth: subscription.fields.auth ?? "" } },
            message
          );
          sent += 1;
        } catch {
          // Assinatura morta/expirada: silenciosa; o unsubscribe do app remove.
        }
      }
      await client.updateRecord("users", user.id, { last_reminder_sent: today });
    }
    return jsonOk({ ok: true, sent, candidates: dueUsers.length });
  } catch (error) { return handleApiError(error); }
}
