"use client";

import { Check, Flame, Mic } from "lucide-react";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";

type HomeTodayCardProps = {
  streak: number;
  practicedToday: boolean;
  goalMinutes: number;
  minutesToday: number;
  percent: number;
  complete: boolean;
  weekConversations: number;
  weekConversationGoal: number;
  onStartPractice: () => void;
};

// Card "Hoje": substitui o antigo banner de lembrete — persiste depois de
// cumprido (check verde) e mostra a meta semanal de conversas.
export function HomeTodayCard(props: HomeTodayCardProps) {
  return <section className="section home-today" aria-label="Sua prática de hoje">
    <div className="top-row">
      <div className="row-title">Hoje</div>
      <span className="pill primary"><Flame size={16} aria-hidden="true" /> {formatPracticeStreak(props.streak)}</span>
    </div>
    <div className="word-big">{props.complete ? "Concluído! 🎉" : `${props.minutesToday} de ${props.goalMinutes} min`}</div>
    <div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.percent} aria-label={`${props.percent}% da meta de hoje`}>
      <span style={{ width: `${props.percent}%` }} />
    </div>
    <p className="row-meta">
      {props.complete
        ? "Meta de hoje batida. Cada dia conta para a sequência."
        : props.streak > 0
          ? `Uma prática rápida mantém sua sequência de ${props.streak} dias.`
          : "Reserve alguns minutos para começar o dia com o pé direito."}
    </p>
    {!props.complete ? (
      <button className="green-button full-button" onClick={props.onStartPractice} type="button"><Mic /> Fazer minha prática</button>
    ) : null}
    <p className="row-meta">Conversas esta semana: {props.weekConversations}/{props.weekConversationGoal}</p>
    {props.complete && !props.practicedToday ? <p className="row-meta" style={{ color: "var(--primary)" }}><Check size={14} /> Sequência garantida pelo treino de hoje.</p> : null}
  </section>;
}
