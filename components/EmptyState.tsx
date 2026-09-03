import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconBubble } from "./IconBubble";

type EmptyStateProps = {
  Icon: LucideIcon;
  title: string;
  description?: ReactNode;
  tone?: "primary" | "warning" | "info" | "danger";
  children?: ReactNode;
};

/** Composição padrão de estado vazio: ícone + título + descrição + CTA opcional. */
export function EmptyState({ Icon, title, description, tone = "primary", children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <IconBubble Icon={Icon} tone={tone} />
      <p className="row-title">{title}</p>
      {description ? <p className="row-meta">{description}</p> : null}
      {children}
    </div>
  );
}
