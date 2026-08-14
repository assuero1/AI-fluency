import { handleApiError, jsonOk } from "@/lib/api/responses";
import { after } from "next/server";
import { warmKokoroLanguage } from "@/lib/kokoro/cache";
import {
  createOrActivateLanguageProfile,
  getSessionUser,
  type LanguageProfileFields,
  type OnboardingPayload,
  updateSessionUserProfile
} from "@/lib/learning/profile";
import { getTeableClient } from "@/lib/supabase/client";

export async function GET() {
  try {
    const user = await getSessionUser();
    const records = (await getTeableClient().listRecords<LanguageProfileFields>("languageProfiles", 50))
      .filter((record) => record.fields.user_id === user.id);
    return jsonOk({ ok: true, records });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OnboardingPayload;
    const user = await updateSessionUserProfile({ name: body.name, timezone: body.timezone });
    const record = await createOrActivateLanguageProfile(user, body);
    after(() => warmKokoroLanguage(record.fields.language_code));
    return jsonOk({ ok: true, record }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
