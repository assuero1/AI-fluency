import type { ReactNode } from "react";

// Balão de fala do mascote — dicas e contexto no formato do logo (rabinho
// embaixo à esquerda). Uso restrito: 1 por tela, para voz de marca
// ("Use 'practice' numa conversa"), nunca para conteúdo estrutural.

type BubbleProps = {
  children: ReactNode;
  className?: string;
};

export function Bubble({ children, className }: BubbleProps) {
  return <div className={["brand-bubble", className].filter(Boolean).join(" ")}>{children}</div>;
}
