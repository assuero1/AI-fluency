"use client";

import { useEffect, useRef } from "react";
import { PartyPopper } from "lucide-react";
import type { MessageGoalProgress } from "@/lib/learning/chat-contracts";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";

type ConversationGoalProgressProps = {
  progress: MessageGoalProgress;
  readOnly?: boolean;
  onFinish?: () => void;
};

export function ConversationGoalProgress({ progress, readOnly = false, onFinish }: ConversationGoalProgressProps) {
  // Inicializa com o estado atual: recarregar uma conversa cuja meta JÁ estava
  // batida não pode disparar festa de novo — só a transição em tempo real.
  const wasReached = useRef(progress.reached);

  useEffect(() => {
    if (progress.enabled && progress.reached && !wasReached.current && !readOnly) {
      wasReached.current = true;
      playSound("goal");
      vibrate("success");
      burstConfetti({ particles: 70 });
    }
  }, [progress.enabled, progress.reached, readOnly]);

  if (!progress.enabled) return null;

  return (
    <section
      aria-label="Meta de mensagens"
      className={`message-goal${progress.reached ? " reached reached-fireworks" : ""}`}
    >
      <div className="message-goal-copy">
        <strong>{progress.reached ? "Meta concluída! 🎉" : `${progress.sent} de ${progress.target} mensagens`}</strong>
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
      {progress.reached && !readOnly && onFinish ? (
        <button className="outline-button" onClick={onFinish} type="button">
          <PartyPopper aria-hidden="true" /> Finalizar com chave de ouro
        </button>
      ) : null}
    </section>
  );
}
