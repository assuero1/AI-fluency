import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getSessionUser } from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/supabase/client";

// Desliga o lembrete: apaga as assinaturas do usuário e zera a hora.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
    const user = await getSessionUser();
    const client = getTeableClient();
    const subscriptions = await client.listRecordsWhereAll<{ endpoint?: string }>("pushSubscriptions", [{ field: "user_id", value: user.id }]);
    for (const subscription of subscriptions) {
      if (typeof body?.endpoint === "string" && subscription.fields.endpoint !== body.endpoint) continue;
      await client.deleteRecord("pushSubscriptions", subscription.id);
    }
    await client.updateRecord("users", user.id, { reminder_hour: null });
    await client.createEvent(user.id, "push_opted_out", {});
    return jsonOk({ ok: true });
  } catch (error) { return handleApiError(error); }
}
