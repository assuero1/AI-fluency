"use client";

import type { MessageGoalProgress } from "@/lib/learning/chat-contracts";

type ConversationGoalProgressProps = {
  progress: MessageGoalProgress;
  readOnly?: boolean;
};

export function ConversationGoalProgress({ progress, readOnly = false }: ConversationGoalProgressProps) {
  if (!progress.enabled) return null;

  return (
    <section
      aria-label="Meta de mensagens"
      className={`message-goal${progress.reached ? " reached" : ""}`}
    >
      <div className="message-goal-copy">
        <strong>{progress.reached ? "Meta concluída!" : `${progress.sent} de ${progress.target} mensagens`}</strong>
        <span>
          {progress.reached
            ? readOnly
              ? "Você alcançou sua meta nesta prática."
              : "Você pode finalizar ou continuar conversando."
            : `Faltam ${progress.remaining}.`}
        </span>
      </div>
      <div
        aria-label={`${progress.percent}% da meta de mensagens`}
        aria-valuemax={progress.target}
        aria-valuemin={0}
        aria-valuenow={Math.min(progress.sent, progress.target)}
        className="message-goal-track"
        role="progressbar"
      >
        <span style={{ width: `${progress.percent}%` }} />
      </div>
    </section>
  );
}
