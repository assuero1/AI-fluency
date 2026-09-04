"use client";

import { Sparkles } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { RarityMeta } from "@/lib/learning/word-rarity";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";
import { burstConfetti } from "@/lib/client/confetti";
import { VoiceButton } from "./VoiceButton";

type UnboxingCardProps = {
  word: { lemma: string; translation: string; partOfSpeech?: string };
  rarity: RarityMeta;
  index: number;
  flipped: boolean;
  onFlip: () => void;
  languageCode?: string;
};

export function UnboxingCard({
  word,
  rarity,
  index,
  flipped,
  onFlip,
  languageCode
}: UnboxingCardProps) {
  function handleCardFlip() {
    if (flipped) return;
    onFlip();
    playSound("achievement");
    vibrate("tap");
    burstConfetti({ particles: 40 });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleCardFlip();
    }
  }

  return (
    <div className={`unboxing-card-wrapper${flipped ? " flipped" : ""}`}>
      <div className="unboxing-card-inner">
        {/* Frente selada */}
        <div
          aria-label={`Carta ${index + 1}: toque para descobrir a palavra nova`}
          className="unboxing-card-front"
          onClick={handleCardFlip}
          onKeyDown={handleKeyDown}
          role="button"
          tabIndex={flipped ? -1 : 0}
        >
          <div className="unboxing-front-icon" aria-hidden="true">
            <Sparkles size={28} />
          </div>
          <span className="eyebrow">Carta {index + 1}</span>
          <strong className="row-title">Toque para descobrir</strong>
          <span className="row-meta">Palavra nova para você</span>
        </div>

        {/* Verso revelado */}
        <div className="unboxing-card-back" aria-live="polite">
          <div className={rarity.badgeClass}>
            <span>{rarity.emoji}</span>
            <span>{rarity.label}</span>
          </div>
          <h3 className="unboxing-word-lemma">{word.lemma}</h3>
          <p className="unboxing-word-translation">{word.translation}</p>
          {languageCode ? (
            <VoiceButton
              compact
              languageCode={languageCode}
              label="Ouvir pronúncia"
              text={word.lemma}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
