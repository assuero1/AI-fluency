import { TalkitoIcon } from "./TalkitoIcon";
import { Pill } from "./Pill";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";

/** Única renderização de streak do app (ver docs/PADRAO_UI.md). */
export function StreakPill({ streak, className = "" }: { streak: number; className?: string }) {
  return (
    <Pill aria-label={`Sequência atual: ${formatPracticeStreak(streak)}`} className={className}>
      <TalkitoIcon name="streak-flame" size={16} className="inline-block" />{" "}
      {formatPracticeStreak(streak)}
    </Pill>
  );
}
