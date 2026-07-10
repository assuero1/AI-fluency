import type { LucideIcon } from "lucide-react";

type Tone = "primary" | "warning" | "info" | "danger";

const toneClass: Record<Tone, string> = {
  primary: "green",
  warning: "yellow",
  info: "blue",
  danger: "red"
};

export function IconBubble({ Icon, tone = "primary" }: { Icon: LucideIcon; tone?: Tone }) {
  return (
    <span className={`icon-circle ${toneClass[tone]}`}>
      <Icon aria-hidden="true" size={31} strokeWidth={2.1} />
    </span>
  );
}
