import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getOrCreatePersonalUser } from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/teable/client";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const user = await getOrCreatePersonalUser();
    const record = await getTeableClient().createRecord("appEvents", {
      user_id: user.id,
      event_name: body.event_name ?? "unknown_event",
      payload: JSON.stringify(body.payload ?? {}),
      created_at: new Date().toISOString()
    });
    return jsonOk({ ok: true, record }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
