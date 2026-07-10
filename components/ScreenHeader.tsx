import { Flame } from "lucide-react";
import { Pill } from "./Pill";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";

export function ScreenHeader({
  title,
  subtitle,
  centered = false,
  streak
}: {
  title: string;
  subtitle?: string;
  centered?: boolean;
  streak?: number;
}) {
  if (centered) {
    return (
      <header className="header-center">
        <h1 className="title">{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </header>
    );
  }

  return (
    <header className="top-row screen-header">
      <div>
        <h1 className="title">{title}</h1>
        {subtitle ? <p className="subtitle">{subtitle}</p> : null}
      </div>
      {typeof streak === "number" ? (
        <Pill aria-label={`Sequência atual: ${formatPracticeStreak(streak)}`}>
          <Flame aria-hidden="true" size={20} color="#f59d1f" fill="#f59d1f" /> {formatPracticeStreak(streak)}
        </Pill>
      ) : null}
    </header>
  );
}
