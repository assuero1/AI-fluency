import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { IconBubble } from "./IconBubble";

type EmptyStateProps = {
  Icon: LucideIcon;
  title: string;
  description?: ReactNode;
  tone?: "primary" | "warning" | "info" | "danger";
  /** Mascote do app (PNG transparente) — substitui o ícone nos momentos de marca. */
  mascotSrc?: string;
  children?: ReactNode;
};

/** Composição padrão de estado vazio: mascote/ícone + título + descrição + CTA opcional. */
export function EmptyState({ Icon, title, description, tone = "primary", mascotSrc, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      {mascotSrc ? (
        // Decorativa: o texto do estado vazio já descreve o momento.
        // eslint-disable-next-line @next/next/no-img-element
        <img className="empty-state-mascot" src={mascotSrc} alt="" width={72} height={72} />
      ) : (
        <IconBubble Icon={Icon} tone={tone} />
      )}
      <p className="row-title">{title}</p>
      {description ? <p className="row-meta">{description}</p> : null}
      {children}
    </div>
  );
}
