"use client";

import { StartFlashcardsWithWords } from "./StartFlashcardsWithWords";
import { TalkitoIcon } from "./TalkitoIcon";

export function ResumoPracticeCta({ wordIds }: { wordIds: string[] }) {
  const capped = wordIds.slice(0, 30);
  if (!capped.length) return null;
  return (
    <div className="resumo-zeigarnik-card">
      <p className="row-meta zeigarnik-text">
        <TalkitoIcon name="brain" size={18} className="inline-block mr-1.5 align-text-bottom" /> <strong>{capped.length} palavra{capped.length === 1 ? "" : "s"} precisa{capped.length === 1 ? "" : "m"} de reforço</strong> nas próximas 24h para consolidar na memória de longo prazo.
      </p>
      <StartFlashcardsWithWords
        label={`Fixar ${capped.length} palavra${capped.length === 1 ? "" : "s"} agora`}
        wordIds={capped}
      />
    </div>
  );
}
