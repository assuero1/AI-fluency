import { IconBubble } from "./IconBubble";
import { Pill } from "./Pill";
import type { LucideIcon } from "lucide-react";
import { TalkitoIcon, type TalkitoIconName } from "./TalkitoIcon";

export function ListRow({
  title,
  meta,
  badge,
  button,
  Icon,
  talkitoIcon,
  tone = "primary"
}: {
  title: string;
  meta?: string;
  badge?: string;
  button?: string;
  Icon?: LucideIcon;
  talkitoIcon?: TalkitoIconName;
  tone?: "primary" | "warning" | "info" | "danger";
}) {
  return (
    <div className="list-row">
      {talkitoIcon ? (
        <IconBubble talkitoIcon={talkitoIcon} tone={tone} />
      ) : Icon ? (
        <IconBubble Icon={Icon} tone={tone} />
      ) : null}
      <div className="row-copy">
        <div className="row-title">
          {title} {badge ? <Pill tone={tone === "danger" ? "warning" : tone}>{badge}</Pill> : null}
        </div>
        {meta ? <div className="row-meta">{meta}</div> : null}
      </div>
      {button ? <button className="outline-button">{button}</button> : <TalkitoIcon name="chevron-right" size={20} />}
    </div>
  );
}
