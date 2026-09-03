"use client";

import { useEffect } from "react";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";

// Padrão de interação do app: TODO <button> clicável dá o clique curto +
// vibração tap (Android), em qualquer tela — sem precisar espalhar chamadas
// manualmente. Opt-out pontual: <button data-silent>. Sons de veredito/
// celebração continuam nos próprios componentes (são outro momento).
export function ButtonFeedback() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      const button = target?.closest?.("button");
      if (!button || button.hasAttribute("disabled") || button.getAttribute("aria-disabled") === "true") return;
      if (button.hasAttribute("data-silent")) return;
      playSound("button");
      vibrate("tap");
    }
    // Capture: roda antes dos handlers dos botões (o som é resposta ao toque,
    // não à ação — inclusive quando a ação falha).
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
