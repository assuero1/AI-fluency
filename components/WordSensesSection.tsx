import type { WordSenseListItem } from "@/lib/learning/words";
import { AddSenseForm } from "./AddSenseForm";
import { Pill } from "./Pill";

const reviewStateLabels: Record<WordSenseListItem["reviewState"], string> = {
  new: "Novo",
  learning: "Aprendendo",
  review: "Em revisão",
  difficult: "Difícil",
  suspended: "Suspenso"
};

type WordSensesSectionProps = {
  wordId: string;
  senses: WordSenseListItem[];
};

export function WordSensesSection({ wordId, senses }: WordSensesSectionProps) {
  return (
    <section className="section word-senses" aria-labelledby="word-senses-title">
      <div className="top-row">
        <h2 className="section-title" id="word-senses-title">Significados</h2>
        <Pill>{senses.length} {senses.length === 1 ? "significado" : "significados"}</Pill>
      </div>
      <ul className="word-senses-list">
        {senses.map((sense, index) => (
          <li className="word-sense-item" key={sense.id || `synthetic-${index}`}>
            <div className="top-row">
              <strong>{sense.translation}</strong>
              {sense.isPrimary ? <Pill tone="primary">Principal</Pill> : null}
            </div>
            <div className="level-pills">
              <Pill tone={sense.needsReview ? "warning" : "default"}>{sense.needsReview ? "Revisar agora" : reviewStateLabels[sense.reviewState]}</Pill>
              {sense.partOfSpeech ? <Pill>{sense.partOfSpeech}</Pill> : null}
            </div>
            <p className="row-meta">{sense.reviewStreak} {sense.reviewStreak === 1 ? "acerto seguido" : "acertos seguidos"} · {sense.lapseCount} {sense.lapseCount === 1 ? "lapso" : "lapsos"}</p>
            {sense.exampleSentence ? <p className="row-meta">“{sense.exampleSentence}”</p> : null}
          </li>
        ))}
      </ul>
      <AddSenseForm wordId={wordId} />
    </section>
  );
}
