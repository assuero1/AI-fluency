"use client";

import { useState } from "react";
import { Check, Info } from "lucide-react";
import { TalkitoIcon } from "./TalkitoIcon";
import type { HuntWord } from "@/lib/learning/word-hunting";

type HuntWordsMissionProps = {
  huntWords: HuntWord[];
  foundWordIds: Set<string>;
};

export function HuntWordsMission({ huntWords, foundWordIds }: HuntWordsMissionProps) {
  const [activeHintId, setActiveHintId] = useState<string | null>(null);

  if (!huntWords.length) return null;

  const total = huntWords.length;
  const foundCount = huntWords.filter((w) => foundWordIds.has(w.wordId)).length;
  const isComplete = foundCount >= total;

  return (
    <section
      aria-label="Missão de vocabulário na conversa"
      className={`hunt-mission-bar${isComplete ? " all-found" : ""}`}
    >
      <div className="hunt-mission-header">
        <div className="hunt-mission-title">
          {isComplete ? (
            <>
              <TalkitoIcon name="trophy" size={18} />
              <span>Missão Completa!</span>
            </>
          ) : (
            <>
              <TalkitoIcon name="target" size={18} />
              <span>Missão: use estas palavras</span>
            </>
          )}
        </div>
        <span className="row-meta">
          {isComplete ? "XP bônus conquistado!" : `${foundCount}/${total} usadas`}
        </span>
      </div>

      <div className="hunt-pills-row">
        {huntWords.map((word) => {
          const isFound = foundWordIds.has(word.wordId);
          const isHintActive = activeHintId === word.wordId;

          return (
            <button
              aria-label={
                isFound
                  ? `Palavra ${word.lemma} já utilizada na conversa`
                  : `Palavra ${word.lemma}: toque para ver tradução`
              }
              className={`hunt-pill${isFound ? " completed" : ""}`}
              key={word.wordId}
              onClick={() => {
                if (!isFound) {
                  setActiveHintId(isHintActive ? null : word.wordId);
                }
              }}
              type="button"
            >
              {isFound ? (
                <Check aria-hidden="true" size={14} />
              ) : (
                <Info aria-hidden="true" size={14} />
              )}
              <span>{word.lemma}</span>
            </button>
          );
        })}
      </div>

      {activeHintId && (
        <div className="hunt-pill-hint">
          {(() => {
            const word = huntWords.find((w) => w.wordId === activeHintId);
            return word ? (
              <span className="inline-flex items-center gap-1.5">
                <TalkitoIcon name="lightbulb" size={16} />
                <span>{word.lemma}: {word.translation}</span>
              </span>
            ) : null;
          })()}
        </div>
      )}
    </section>
  );
}
