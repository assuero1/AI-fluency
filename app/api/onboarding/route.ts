import { handleApiError, jsonOk } from "@/lib/api/responses";
import { after } from "next/server";
import { warmKokoroLanguage } from "@/lib/kokoro/cache";
import {
  createOrActivateLanguageProfile,
  getActiveLanguageProfile,
  getOnboardingRedirectTarget,
  getOrCreatePersonalUser,
  OnboardingPayload
} from "@/lib/learning/profile";

export async function GET() {
  try {
    const user = await getOrCreatePersonalUser();
    const activeProfile = await getActiveLanguageProfile(user);
    const readiness = getOnboardingRedirectTarget();

    return jsonOk({
      ok: true,
      user,
      activeProfile,
      ...readiness
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as OnboardingPayload & { mode?: "onboarding" | "language" };
    const user = await getOrCreatePersonalUser({ name: body.name, timezone: body.timezone });
    const profile = await createOrActivateLanguageProfile(user, body);
    const readiness = getOnboardingRedirectTarget();
    after(() => warmKokoroLanguage(profile.fields.language_code));

    return jsonOk(
      {
        ok: true,
        user,
        profile,
        ...readiness
      },
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
