import { ArrowRight } from "lucide-react";
import Link from "next/link";

type SectionHeaderProps = {
  title: string;
  actionLabel?: string;
  actionHref?: string;
};

/** Título de seção + ação "Ver tudo" opcional, alinhada à direita. */
export function SectionHeader({ title, actionLabel, actionHref }: SectionHeaderProps) {
  return (
    <header className="section-header">
      <h2 className="section-title">{title}</h2>
      {actionLabel && actionHref ? (
        <Link className="link-action" href={actionHref}>
          {actionLabel}
          <ArrowRight aria-hidden="true" size={16} />
        </Link>
      ) : null}
    </header>
  );
}
