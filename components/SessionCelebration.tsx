"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { TalkitoIcon } from "./TalkitoIcon";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";
import { CountUp } from "./CountUp";

type SessionCelebrationProps = { score: number; eyebrow: string; children?: ReactNode };

// Festa padrão de fim de sessão: som + vibração + confetti + troféu quicando
// e score contando. Dispara UMA vez por montagem (StrictMode remonta no dev:
// o guard evita fanfarra dupla).
export function SessionCelebration({ score, eyebrow, children }: SessionCelebrationProps) {
  // O guard em ref cobre o duplo efeito do StrictMode (dev): ele re-executa
  // os efeitos na MESMA instância de componente, e refs persistem entre essas
  // re-execuções — sem o guard a fanfarra toca duas vezes na mesma montagem.
  const celebratedRef = useRef(false);

  useEffect(() => {
    if (celebratedRef.current) return;
    celebratedRef.current = true;
    playSound("complete");
    vibrate("celebrate");
    burstConfetti({ particles: score >= 80 ? 130 : 70 });
  }, [score]);

  return <>
    <div className="flashcard-trophy celebrate"><TalkitoIcon name="trophy" size={48} /></div>
    <div className="eyebrow">{eyebrow}</div>
    <h1 className="title"><CountUp value={score} suffix="% de acerto" /></h1>
    {children}
  </>;
}
