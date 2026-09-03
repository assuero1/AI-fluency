"use client";

import { useEffect, useState } from "react";
import { LoadingDots } from "@/components/LoadingDots";

export type LoadingPalette = "brand" | "chat" | "calendario" | "palavras" | "progresso" | "neutral";
export type LoadingMoment = "enter" | "save" | "think";

const TIP_INTERVAL_MS = 2500;

// Tela de carregamento do app: o mascote camaleão (animado em hyperframes,
// código-fonte em assets/loading-anim) muda de cor conforme a paleta da
// seção onde o carregamento acontece. Cada momento tem sua composição:
// "enter" (entrar em módulo/sessão), "save" (salvando resultado) e
// "think" (esperando a IA).
// variant "screen" ocupa a área de conteúdo (rotas); "overlay" cobre a tela
// com a seção escurecida (salvar/entrar acionado por clique); "inline" é a
// versão compacta para slots internos (bolha do chat, painéis).
export function LoadingScene({
  moment = "enter",
  palette = "brand",
  title,
  note,
  tips,
  srText,
  variant = "screen"
}: {
  moment?: LoadingMoment;
  palette?: LoadingPalette;
  title?: string;
  note?: string;
  tips?: string[];
  srText?: string;
  variant?: "screen" | "overlay" | "inline";
}) {
  const [ready, setReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [tipIndex, setTipIndex] = useState(0);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!tips || tips.length < 2) return;
    const timer = setInterval(() => setTipIndex((current) => (current + 1) % tips.length), TIP_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [tips]);

  const scene = (
    <>
      <span aria-hidden="true" className="loading-scene-card">
        {/* O still fica sob o vídeo: presença instantânea do mascote na primeira
            carga (depois o SW cacheia o vídeo e a troca é imperceptível). */}
        <img alt="" className="loading-scene-still" src="/loading/mascot.png" />
        {!reducedMotion
          ? // eslint-disable-next-line @next/next/no-img-element -- asset estático minúsculo, sem pipeline de imagem
            <video
              autoPlay
              className={`loading-scene-video${ready ? " ready" : ""}`}
              loop
              muted
              onCanPlay={() => setReady(true)}
              playsInline
              preload="auto"
              src={`/loading/${moment}-${palette}.mp4`}
            />
          : null}
      </span>
      {title ? <strong className="loading-scene-title">{title}</strong> : null}
      <LoadingDots srText={srText ?? title ?? "Carregando..."} />
      {note ? <span className="loading-scene-note">{note}</span> : null}
      {tips && tips.length > 0 ? <span aria-live="polite" className="loading-scene-tip">{tips[tipIndex]}</span> : null}
    </>
  );

  if (variant === "inline") {
    return <span className={`loading-scene inline palette-${palette}`}>{scene}</span>;
  }
  return (
    <div className={`loading-scene ${variant} palette-${palette}`}>
      <div className="loading-scene-box">{scene}</div>
    </div>
  );
}
