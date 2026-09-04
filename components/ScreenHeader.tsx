import type { ReactNode } from "react";
import { StreakPill } from "./StreakPill";

export function ScreenHeader({
  title,
  subtitle,
  centered = false,
  streak
}: {
  title: ReactNode;
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
      {typeof streak === "number" ? <StreakPill streak={streak} /> : null}
    </header>
  );
}
