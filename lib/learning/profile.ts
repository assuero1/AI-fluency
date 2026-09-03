import { cache } from "react";
import { getConnectionStatus, isDataBackendReady } from "@/lib/settings/status";
import { getRequestSupabaseClient } from "@/lib/supabase/server";
import { getTeableClient, safeUpdateRecord, TeableRecord } from "@/lib/supabase/client";
import { normalizeNewCardsQuota } from "./daily-queue";
import { DEFAULT_LANGUAGE_LEVEL, isLanguageLevel } from "./levels";

export type UserFields = {
  Name?: string;
  name?: string;
  avatar_url?: string;
  active_language_id?: string;
  timezone?: string;
  daily_new_cards_quota?: number;
  current_streak?: number;
  longest_streak?: number;
  last_practice_day?: string;
  streak_freeze_used_on?: string;
  milestone_seen?: number;
  daily_goal_minutes?: number;
  reminder_hour?: number;
  last_reminder_sent?: string;
  created_at?: string;
};

export type LanguageProfileFields = {
  user_id: string;
  language_code: string;
  language_name: string;
  level: string;
  learning_goal: string;
  correction_style: string;
  audio_enabled: boolean;
  transcript_enabled: boolean;
  calendar_memory_enabled: boolean;
  weekly_conversation_goal: number;
  weekly_word_goal: number;
  created_at: string;
  updated_at: string;
};

export type OnboardingPayload = {
  name?: string;
  timezone?: string;
  language_code?: string;
  language_name?: string;
  level?: string;
  learning_goal?: string;
  correction_style?: string;
  audio_enabled?: boolean;
  transcript_enabled?: boolean;
  calendar_memory_enabled?: boolean;
  weekly_conversation_goal?: number;
  weekly_word_goal?: number;
};

export class UnauthenticatedError extends Error {
  status = 401;
}

export class UserLinkError extends Error {
  status = 500;
}

// Cached per server request (React cache): uma leitura de sessão + uma query
// por request; fora de request é passthrough.
export const getSessionUser = cache(async function getSessionUser() {
  const supabase = await getRequestSupabaseClient();
  const {
    data: { user: authUser }
  } = await supabase.auth.getUser();
  if (!authUser) {
    throw new UnauthenticatedError("Sessão expirada. Faça login novamente.");
  }

  const records = await getTeableClient().listRecordsWhereAll<UserFields>("users", [
    { field: "auth_user_id", value: authUser.id }
  ]);
  const record = records[0];
  if (!record) {
    // O trigger on_auth_user_created deveria ter criado o registro no signup.
    console.error(JSON.stringify({ event: "user_link_missing", auth_user_id: authUser.id, timestamp: new Date().toISOString() }));
    throw new UserLinkError("Conta sem perfil vinculado. Fale com o suporte.");
  }
  return record;
});

export async function updateSessionUserProfile(payload: Pick<OnboardingPayload, "name" | "timezone">) {
  const user = await getSessionUser();
  const name = payload.name?.trim().slice(0, 80);
  const updated = await getTeableClient().updateRecord<UserFields>("users", user.id, {
    // Nome em branco/ausente preserva o existente — troca de idioma não pode
    // apagar o nome do usuário.
    Name: name || user.fields.Name || "",
    timezone: payload.timezone ?? user.fields.timezone ?? "America/Sao_Paulo"
  });
  return updated;
}

export function getDailyNewCardsQuota(user: TeableRecord<UserFields>) {
  return normalizeNewCardsQuota(user.fields.daily_new_cards_quota);
}

export const getActiveLanguageProfile = cache(async function getActiveLanguageProfile(user?: TeableRecord<UserFields>) {
  const client = getTeableClient();
  const profileId = user?.fields.active_language_id;
  const profiles = await client.listRecords<LanguageProfileFields>("languageProfiles", 50);

  if (profileId) {
    const active = profiles.find((profile) => profile.id === profileId && profile.fields.user_id === user?.id);
    if (active) return active;
  }

  return profiles.find((profile) => profile.fields.user_id === user?.id) ?? null;
});

export async function createLanguageProfile(user: TeableRecord<UserFields>, payload: OnboardingPayload) {
  const client = getTeableClient();
  const now = new Date().toISOString();
  const profile = await client.createRecord<LanguageProfileFields>("languageProfiles", {
    user_id: user.id,
    language_code: payload.language_code ?? "en",
    language_name: payload.language_name ?? "Inglês",
    level: isLanguageLevel(payload.level) ? payload.level : DEFAULT_LANGUAGE_LEVEL,
    learning_goal: payload.learning_goal ?? "Falar com mais naturalidade em situações reais.",
    correction_style: payload.correction_style ?? "Corrigir sempre",
    audio_enabled: payload.audio_enabled ?? true,
    transcript_enabled: payload.transcript_enabled ?? true,
    calendar_memory_enabled: payload.calendar_memory_enabled ?? true,
    weekly_conversation_goal: payload.weekly_conversation_goal ?? 7,
    weekly_word_goal: payload.weekly_word_goal ?? 500,
    created_at: now,
    updated_at: now
  });

  await safeUpdateRecord<UserFields>("users", user.id, { active_language_id: profile.id });
  await client.createEvent(user.id, "language_profile_created", {
    language_code: profile.fields.language_code,
    language_name: profile.fields.language_name,
    level: profile.fields.level,
    correction_style: profile.fields.correction_style
  });

  return profile;
}

export async function createOrActivateLanguageProfile(user: TeableRecord<UserFields>, payload: OnboardingPayload) {
  const client = getTeableClient();
  const languageCode = (payload.language_code ?? "en").toLowerCase();
  const profiles = await client.listRecords<LanguageProfileFields>("languageProfiles", 50);
  const existingProfile = profiles.find(
    (profile) => profile.fields.user_id === user.id && profile.fields.language_code.toLowerCase() === languageCode
  );

  if (!existingProfile) return createLanguageProfile(user, payload);

  let activeProfile = existingProfile;
  const nextLevel = isLanguageLevel(payload.level) ? payload.level : null;
  if (nextLevel && nextLevel !== existingProfile.fields.level) {
    activeProfile = await client.updateRecord<LanguageProfileFields>("languageProfiles", existingProfile.id, {
      level: nextLevel,
      updated_at: new Date().toISOString()
    });
    await client.createEvent(user.id, "language_level_updated", {
      language_code: existingProfile.fields.language_code,
      previous_level: existingProfile.fields.level,
      level: nextLevel
    });
  }

  await safeUpdateRecord<UserFields>("users", user.id, { active_language_id: existingProfile.id });
  await client.createEvent(user.id, "language_profile_activated", {
    language_code: activeProfile.fields.language_code,
    language_name: activeProfile.fields.language_name,
    level: activeProfile.fields.level
  });

  return activeProfile;
}

export async function getOnboardingRedirectTarget() {
  const status = await getConnectionStatus();
  const backendReady = isDataBackendReady(status);
  const aiReady = status.ai.configured;

  return {
    status,
    readyForPractice: backendReady && aiReady,
    redirectTo: backendReady && aiReady ? "/" : "/settings/connections"
  };
}
