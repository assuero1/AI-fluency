"use client";

import { LANGUAGE_LEVELS, LanguageLevel } from "@/lib/learning/levels";
import { Pill } from "./Pill";

export function LevelPills({ level, onChange }: { level: string; onChange: (level: LanguageLevel) => void }) {
  return (
    <div aria-label="Nível de conhecimento" className="level-pills" role="group">
      {LANGUAGE_LEVELS.map((option) => (
        <button aria-pressed={option === level} className="plain-button" key={option} onClick={() => onChange(option)} type="button">
          <Pill tone={option === level ? "primary" : "default"}>{option}</Pill>
        </button>
      ))}
    </div>
  );
}
