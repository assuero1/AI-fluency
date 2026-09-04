"use client";

import { TalkitoIcon } from "./TalkitoIcon";

type QuestView = {
  key: string;
  title: string;
  target: number;
  progress: number;
  complete: boolean;
};

export function QuestList({ quests }: { quests: QuestView[] }) {
  if (!quests.length) return null;
  return <section className="section" aria-label="Missões de hoje">
    <h2 className="section-title">Missões de hoje</h2>
    <div className="row-list">
      {quests.map((quest) => <div className={`list-row${quest.complete ? " quest-complete" : ""}`} key={quest.key}>
        <span className={`icon-circle ${quest.complete ? "green" : ""}`}><TalkitoIcon name="check-stamp" size={24} /></span>
        <div className="row-copy">
          <div className="row-title">{quest.title}</div>
          <div className="row-meta">{quest.target > 1 ? `${quest.progress}/${quest.target}` : quest.complete ? "Concluída" : "Pendente"}</div>
        </div>
        <TalkitoIcon name="target" size={20} className="filter-icon" />
      </div>)}
    </div>
  </section>;
}
