import { ChevronLeft } from "lucide-react";
import Link from "next/link";

type BackButtonProps = {
  label: string;
  href?: string;
  onClick?: () => void;
};

/** Botão voltar padrão de toda tela de detalhe: "Voltar a X" na cor da seção. */
export function BackButton({ label, href, onClick }: BackButtonProps) {
  const content = (
    <>
      <ChevronLeft aria-hidden="true" size={20} />
      {label}
    </>
  );

  if (href) {
    return (
      <Link className="back-link" href={href}>
        {content}
      </Link>
    );
  }

  return (
    <button className="back-link button-reset" onClick={onClick} type="button">
      {content}
    </button>
  );
}
