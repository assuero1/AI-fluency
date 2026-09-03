import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getSessionUser } from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/supabase/client";

// Confirma que o usuário já viu a celebração do marco atual, para ela não
// reaparecer em todo carregamento da Home.
export async function POST() {
  try {
    const user = await getSessionUser();
    const client = getTeableClient();
    await client.updateRecord("users", user.id, { milestone_seen: Number(user.fields.current_streak ?? 0) });
    await client.createEvent(user.id, "streak_milestone_acknowledged", { streak: Number(user.fields.current_streak ?? 0) });
    return jsonOk({ ok: true });
  } catch (error) { return handleApiError(error); }
}
