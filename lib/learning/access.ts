import "server-only";

import { getConnectionStatus } from "@/lib/settings/status";
import { getTeableClient, TeableClient, TeableRecord } from "@/lib/teable/client";
import {
  getActiveLanguageProfile,
  getExistingPersonalUser,
  LanguageProfileFields,
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

function hasMappedTeableSchema() {
  const status = getConnectionStatus();
  return status.teable.configured && status.teable.mappedTableCount === status.teable.totalTableCount;
}

export async function getLearningGate() {
  const status = getConnectionStatus();
  const teableReady = hasMappedTeableSchema();

  if (!teableReady) {
    return { gate: "connections" as const, status, user: null, profile: null };
  }

  const user = await getExistingPersonalUser();
  const profile = user ? await getActiveLanguageProfile(user) : null;
  const gate = resolveLearningGate({ hasProfile: Boolean(profile), teableReady, aiReady: status.ai.configured });

  return { gate, status, user, profile };
}

export async function assertPracticeReady(): Promise<ReadyLearningAccess> {
  const gate = await getLearningGate();

  if (gate.gate === "connections") {
    throw new LearningStateError("Configure o Teable e a IA antes de iniciar uma conversa.");
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
