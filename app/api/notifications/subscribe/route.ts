import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getSessionUser } from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/supabase/client";

type SubscriptionBody = {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
  reminderHour?: unknown;
};

// Grava a assinatura push do navegador + a hora local preferida do lembrete.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as SubscriptionBody | null;
    const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
    const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
    const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
    if (!endpoint || !p256dh || !auth) {
      return jsonOk({ ok: false, error: "Assinatura push inválida." }, { status: 422 });
    }
    const user = await getSessionUser();
    const client = getTeableClient();
    const existing = await client.listRecordsWhereAll("pushSubscriptions", [
      { field: "user_id", value: user.id },
      { field: "endpoint", value: endpoint }
    ]);
    if (!existing.length) {
      await client.createRecord("pushSubscriptions", { user_id: user.id, endpoint, p256dh, auth });
    }
    const reminderHour = Number(body?.reminderHour);
    if (Number.isInteger(reminderHour) && reminderHour >= 0 && reminderHour <= 23) {
      await client.updateRecord("users", user.id, { reminder_hour: reminderHour });
    }
    await client.createEvent(user.id, "push_opted_in", { reminder_hour: Number.isInteger(reminderHour) ? reminderHour : null });
    return jsonOk({ ok: true });
  } catch (error) { return handleApiError(error); }
}
