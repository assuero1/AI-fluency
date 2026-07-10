import { handleApiError, jsonOk } from "@/lib/api/responses";
import { getProfileSettings, updatePersonalProfile } from "@/lib/learning/account";
import { getOrCreatePersonalUser } from "@/lib/learning/profile";

export async function GET() {
  try {
    return jsonOk({ ok: true, profile: await getProfileSettings() });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const record = await updatePersonalProfile({
      name: typeof body.name === "string" ? body.name : undefined,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined,
      activeLanguageId: typeof body.activeLanguageId === "string" ? body.activeLanguageId : undefined
    });
    return jsonOk({ ok: true, record });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const record = await getOrCreatePersonalUser({
      name: typeof body.name === "string" ? body.name : undefined,
      timezone: typeof body.timezone === "string" ? body.timezone : undefined
    });
    return jsonOk({ ok: true, record }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
