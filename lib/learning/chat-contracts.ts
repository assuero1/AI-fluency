export const INTERACTION_MODES = ["conversation", "simulation"] as const;
export type InteractionMode = (typeof INTERACTION_MODES)[number];

export const MESSAGE_CHANNELS = ["practice", "teacher"] as const;
export type MessageChannel = (typeof MESSAGE_CHANNELS)[number];

// Cap do texto enviado pelo aluno, aplicado nos dois canais (practice e
// teacher). Compartilhado entre o servidor (conversations/conversation-teacher)
// e o cliente (maxLength do composer).
export const MAX_USER_MESSAGE_LENGTH = 2000;

type CountableMessage = { fields: { role?: string; channel?: string } };

export type MessageGoalProgress = {
  enabled: boolean;
  sent: number;
  target: number;
  remaining: number;
  reached: boolean;
  percent: number;
};

export function isInteractionMode(value: unknown): value is InteractionMode {
  return typeof value === "string" && INTERACTION_MODES.includes(value as InteractionMode);
}

export function normalizeStoredInteractionMode(value: unknown): InteractionMode {
  return value === "simulation" ? "simulation" : "conversation";
}

export function isPracticeChannel(value: unknown) {
  return value === undefined || value === null || value === "" || value === "practice";
}

export function isTeacherChannel(value: unknown) {
  return value === "teacher";
}

export function normalizeStoredMessageTarget(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isInteger(numeric) && numeric >= 1 && numeric <= 50 ? numeric : 0;
}

export function getMessageGoalProgress(messages: CountableMessage[], rawTarget: unknown): MessageGoalProgress {
  const target = normalizeStoredMessageTarget(rawTarget);
  const sent = messages.filter((message) => message.fields.role === "user" && isPracticeChannel(message.fields.channel)).length;
  const remaining = target ? Math.max(0, target - sent) : 0;
  return {
    enabled: target > 0,
    sent,
    target,
    remaining,
    reached: target > 0 && remaining === 0,
    percent: target > 0 ? Math.min(100, Math.round((sent / target) * 100)) : 0
  };
}

export function isValidClientRequestId(value: string) {
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/.test(value);
}
