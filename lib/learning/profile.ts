import { getConnectionStatus } from "@/lib/settings/status";
import { getEnv } from "@/lib/env";
import { getTeableClient, safeUpdateRecord, TeableRecord } from "@/lib/teable/client";

export type UserFields = {
  Name?: string;
  name?: string;
  avatar_url?: string;
  active_language_id?: string;
  timezone?: string;
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

export class PersonalUserResolutionError extends Error {
  status = 409;
}

export async function getOrCreatePersonalUser(payload?: Pick<OnboardingPayload, "name" | "timezone">) {
  const client = getTeableClient();
  const existing = await getExistingPersonalUser();
  if (existing) return existing;

  return client.createRecord<UserFields>("users", {
    Name: payload?.name ?? "Camila",
    avatar_url: "",
    active_language_id: "",
    timezone: payload?.timezone ?? "America/Sao_Paulo",
    created_at: new Date().toISOString()
  });
}

export async function getExistingPersonalUser() {
  const users = await getTeableClient().listRecords<UserFields>("users", 100);
  return resolvePersonalUser(users, getEnv("AI_FLUENCY_USER_ID"));
}

export function resolvePersonalUser(users: TeableRecord<UserFields>[], configuredUserId?: string) {
  if (configuredUserId) {
    const configured = users.find((user) => user.id === configuredUserId);
    if (!configured) {
      throw new PersonalUserResolutionError(
        "O usuário configurado em AI_FLUENCY_USER_ID não foi encontrado no Teable."
      );
    }
    return configured;
  }

  const candidates = users.filter((user) => Boolean(user.fields.Name?.trim() || user.fields.created_at));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  throw new PersonalUserResolutionError(
    "Há mais de um usuário no Teable. Configure AI_FLUENCY_USER_ID para selecionar o perfil pessoal com segurança."
  );
}

export async function getActiveLanguageProfile(user?: TeableRecord<UserFields>) {
  const client = getTeableClient();
  const profileId = user?.fields.active_language_id;
  const profiles = await client.listRecords<LanguageProfileFields>("languageProfiles", 50);

  if (profileId) {
    const active = profiles.find((profile) => profile.id === profileId && profile.fields.user_id === user?.id);
    if (active) return active;
  }

  return profiles.find((profile) => profile.fields.user_id === user?.id) ?? null;
}

export async function createLanguageProfile(user: TeableRecord<UserFields>, payload: OnboardingPayload) {
  const client = getTeableClient();
  const now = new Date().toISOString();
  const profile = await client.createRecord<LanguageProfileFields>("languageProfiles", {
    user_id: user.id,
    language_code: payload.language_code ?? "en",
    language_name: payload.language_name ?? "Inglês",
    level: payload.level ?? "Intermediário (B1)",
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

  await safeUpdateRecord<UserFields>("users", user.id, { active_language_id: existingProfile.id });
  await client.createEvent(user.id, "language_profile_activated", {
    language_code: existingProfile.fields.language_code,
    language_name: existingProfile.fields.language_name,
    level: existingProfile.fields.level
  });

  return existingProfile;
}

export function getOnboardingRedirectTarget() {
  const status = getConnectionStatus();
  const teableReady = status.teable.configured && status.teable.mappedTableCount === status.teable.totalTableCount;
  const aiReady = status.ai.configured;

  return {
    status,
    readyForPractice: teableReady && aiReady,
    redirectTo: teableReady && aiReady ? "/" : "/settings/connections"
  };
}
