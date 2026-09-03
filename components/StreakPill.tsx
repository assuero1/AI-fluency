import { Flame } from "lucide-react";
import { Pill } from "./Pill";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";

/** Única renderização de streak do app (ver docs/PADRAO_UI.md). */
export function StreakPill({ streak, className = "" }: { streak: number; className?: string }) {
  return (
    <Pill aria-label={`Sequência atual: ${formatPracticeStreak(streak)}`} className={className}>
      <Flame aria-hidden="true" size={16} color="var(--streak)" fill="var(--streak)" />{" "}
      {formatPracticeStreak(streak)}
    </Pill>
  );
}
