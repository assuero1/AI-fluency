"use client";

import { Brain, Check, ChevronRight, MessageCircle, Sparkles } from "lucide-react";
import Link from "next/link";

export type DailyTrailStatus = {
  newWordsDone: boolean;
  conversationDone: boolean;
  reviewDone: boolean;
};

type DailyTrailCardProps = {
  trail?: DailyTrailStatus;
  onStartConversation: () => void;
};

export function DailyTrailCard({ trail, onStartConversation }: DailyTrailCardProps) {
  const newWordsDone = Boolean(trail?.newWordsDone);
  const conversationDone = Boolean(trail?.conversationDone);
  const reviewDone = Boolean(trail?.reviewDone);

  const completedCount = [newWordsDone, conversationDone, reviewDone].filter(Boolean).length;
  const allComplete = completedCount === 3;

  const steps = [
    {
      id: "new-words",
      stepNumber: 1,
      title: "Palavras Novas",
      hint: "Unboxing & Adoção",
      icon: Sparkles,
      tone: "palavras",
      done: newWordsDone,
      href: "/palavras/novas",
      action: null
    },
    {
      id: "conversation",
      stepNumber: 2,
      title: "Conversar com IA",
      hint: "Caça a Palavras",
      icon: MessageCircle,
      tone: "chat",
      done: conversationDone,
      href: null,
      action: onStartConversation
    },
    {
      id: "review",
      stepNumber: 3,
      title: "Revisão Inteligente",
      hint: "Combos em Chamas",
      icon: Brain,
      tone: "brand",
      done: reviewDone,
      href: "/palavras/treino",
      action: null
    }
  ];

  return (
    <section aria-label="Trilha do Dia" className="section daily-trail-card">
      <div className="top-row">
        <div>
          <h2 className="section-title">Trilha do Dia</h2>
          <p className="row-meta">
            {allComplete
              ? "Parabéns! Você completou o ciclo de retenção hoje."
              : "Complete o ciclo virtuoso: Novas → Chat → Revisão"}
          </p>
        </div>
        <span
          aria-label={`${completedCount} de 3 etapas concluídas`}
          className={`trail-progress-badge${allComplete ? " all-done" : ""}`}
        >
          {allComplete ? "🎉 3/3" : `${completedCount}/3`}
        </span>
      </div>

      <ol className="trail-step-list">
        {steps.map((step) => {
          const StepIcon = step.icon;
          const content = (
            <>
              <span className={`trail-step-indicator ${step.tone}${step.done ? " done" : ""}`}>
                {step.done ? (
                  <Check aria-hidden="true" size={16} />
                ) : (
                  <span className="trail-step-num">{step.stepNumber}</span>
                )}
              </span>
              <div className="trail-step-content">
                <div className="trail-step-header">
                  <span className={`trail-step-title${step.done ? " done-text" : ""}`}>
                    {step.title}
                  </span>
                  <span className="trail-step-hint">{step.hint}</span>
                </div>
              </div>
              <StepIcon aria-hidden="true" className={`trail-step-icon ${step.tone}`} size={20} />
              <ChevronRight aria-hidden="true" className="trail-step-arrow" size={16} />
            </>
          );

          return (
            <li key={step.id} className="trail-step-item">
              {step.href ? (
                <Link
                  aria-label={`${step.title} — ${step.done ? "Concluído" : "Pendente"}`}
                  className={`trail-step-action${step.done ? " step-done" : ""}`}
                  href={step.href}
                >
                  {content}
                </Link>
              ) : (
                <button
                  aria-label={`${step.title} — ${step.done ? "Concluído" : "Pendente"}`}
                  className={`trail-step-action${step.done ? " step-done" : ""}`}
                  onClick={step.action ?? undefined}
                  type="button"
                >
                  {content}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
