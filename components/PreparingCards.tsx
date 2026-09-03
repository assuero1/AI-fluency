"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

const TIPS = [
  "Revisar pouco e sempre fixa mais que muito de uma vez.",
  "Dizer a tradução em voz alta antes de digitar aumenta a retenção.",
  "Errar faz parte: cada erro ajusta quando a palavra volta a aparecer.",
  "Palavras usadas em conversa grudam mais que palavras de lista.",
  "Cinco minutos por dia vencem uma hora por semana."
];

// Espera do preparo do deck (a IA gera as frases em 15–40s): skeleton com
// shimmer + dicas rotativas, em vez de um label parado no botão.
export function PreparingCards({ languageName }: { languageName: string }) {
  const [tip, setTip] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setTip((current) => (current + 1) % TIPS.length), 2500);
    return () => clearInterval(timer);
  }, []);

  return <section className="section preparing-cards" aria-live="polite" aria-label="Preparando suas frases">
    <div className="skeleton skeleton-card" />
    <div className="skeleton skeleton-line" />
    <div className="skeleton skeleton-line skeleton-w70" />
    <p className="row-meta"><Sparkles size={14} aria-hidden="true" /> {TIPS[tip]}</p>
    <p className="row-meta">A IA está escolhendo palavras do seu nível e montando frases em {languageName}. Isso costuma levar até 1 minuto.</p>
  </section>;
}
