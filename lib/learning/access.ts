import "server-only";

import { getConnectionStatus, isDataBackendReady } from "@/lib/settings/status";
import { getTeableClient, TeableClient, TeableRecord } from "@/lib/teable/client";
import {
  getActiveLanguageProfile,
  getSessionUser,
  LanguageProfileFields,
  UnauthenticatedError,
  UserFields
} from "./profile";
import { resolveLearningGate } from "./conversation-state";

export class LearningStateError extends Error {
  constructor(message: string, public status = 409) {
    super(message);
  }
}

type ReadyLearningAccess = {
  client: TeableClient;
  user: TeableRecord<UserFields>;
  profile: TeableRecord<LanguageProfileFields>;
};

export async function getLearningGate() {
  const status = await getConnectionStatus();
  const teableReady = isDataBackendReady(status);

  if (!teableReady) {
    return { gate: "connections" as const, status, user: null, profile: null };
  }

  let user;
  try {
    user = await getSessionUser();
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      return { gate: "login" as const, status, user: null, profile: null };
    }
    throw error;
  }
  const profile = await getActiveLanguageProfile(user);
  const gate = resolveLearningGate({ hasProfile: Boolean(profile), teableReady, aiReady: status.ai.configured });

  return { gate, status, user, profile };
}

export async function assertPracticeReady(): Promise<ReadyLearningAccess> {
  const gate = await getLearningGate();

  if (gate.gate === "connections") {
    throw new LearningStateError("Configure o banco de dados e a IA nas configurações.");
  }
  if (!gate.user || !gate.profile) {
    throw new LearningStateError("Conclua o onboarding e escolha um idioma antes de iniciar uma conversa.");
  }

  return {
    client: getTeableClient(),
    user: gate.user,
    profile: gate.profile
  };
}
