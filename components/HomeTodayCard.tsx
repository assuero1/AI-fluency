"use client";

import { TalkitoIcon } from "./TalkitoIcon";

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
// cumprido (check verde) e mostra a meta semanal de conversas. O streak em
// pill mora no ScreenHeader; aqui ele só aparece no texto motivacional.
export function HomeTodayCard(props: HomeTodayCardProps) {
  return <section className="section home-today" aria-label="Sua prática de hoje">
    <div className="top-row">
      <div className="row-title">Hoje</div>
      <div className="row-meta">meta de {props.goalMinutes} min</div>
    </div>
    <div className="word-big">
      {props.complete ? (
        <span className="inline-flex items-center gap-1.5">
          Concluído! <TalkitoIcon name="party-popper" size={26} />
        </span>
      ) : (
        `${props.minutesToday} de ${props.goalMinutes} min`
      )}
    </div>
    <div className="progress-line" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={props.percent} aria-label={`${props.percent}% da meta de hoje`}>
      <span className="progress-fill" style={{ transform: `scaleX(${props.percent / 100})` }} />
    </div>
    <p className="row-meta">
      {props.complete
        ? "Meta de hoje batida. Cada dia conta para a sequência."
        : props.streak > 0
          ? `Uma prática rápida mantém sua sequência de ${props.streak} dias.`
          : "Reserve alguns minutos para começar o dia com o pé direito."}
    </p>
    {!props.complete ? (
      <button className="green-button full-button" onClick={props.onStartPractice} type="button">
        <TalkitoIcon name="microphone" size={20} className="inline-block mr-2" /> Fazer minha prática
      </button>
    ) : null}
    <p className="row-meta">Conversas esta semana: {props.weekConversations}/{props.weekConversationGoal}</p>
    {props.complete && !props.practicedToday ? (
      <p className="row-meta text-accent">
        <TalkitoIcon name="check-stamp" size={14} className="inline-block mr-1" /> Sequência garantida pelo treino de hoje.
      </p>
    ) : null}
  </section>;
}
