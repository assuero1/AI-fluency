import { ChevronRight } from "lucide-react";
import { IconBubble } from "./IconBubble";
import { Pill } from "./Pill";
import type { LucideIcon } from "lucide-react";

export function ListRow({
  title,
  meta,
  badge,
  button,
  Icon,
  tone = "primary"
}: {
  title: string;
  meta?: string;
  badge?: string;
  button?: string;
  Icon?: LucideIcon;
  tone?: "primary" | "warning" | "info" | "danger";
}) {
  return (
    <div className="list-row">
      {Icon ? <IconBubble Icon={Icon} tone={tone} /> : null}
      <div className="row-copy">
        <div className="row-title">
          {title} {badge ? <Pill tone={tone === "danger" ? "warning" : tone}>{badge}</Pill> : null}
        </div>
        {meta ? <div className="row-meta">{meta}</div> : null}
      </div>
      {button ? <button className="outline-button">{button}</button> : <ChevronRight color="#2f9d4a" />}
    </div>
  );
}
