import type { LucideIcon } from "lucide-react";
import { TalkitoIcon, type TalkitoIconName } from "./TalkitoIcon";

type Tone = "primary" | "warning" | "info" | "danger";

const toneClass: Record<Tone, string> = {
  primary: "green",
  warning: "yellow",
  info: "blue",
  danger: "red"
};

export function IconBubble({
  Icon,
  talkitoIcon,
  tone = "primary"
}: {
  Icon?: LucideIcon;
  talkitoIcon?: TalkitoIconName;
  tone?: Tone;
}) {
  return (
    <span className={`icon-circle ${toneClass[tone]}`}>
      {talkitoIcon ? (
        <TalkitoIcon name={talkitoIcon} size={28} />
      ) : Icon ? (
        <Icon aria-hidden="true" size={28} strokeWidth={2.1} />
      ) : null}
    </span>
  );
}
