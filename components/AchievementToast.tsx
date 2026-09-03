"use client";

import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";

type AchievementUnlock = { key: string; title: string; description: string };

const STORAGE_KEY = "ai-fluency:unlocked-achievements";

// Lido pelos 3 hooks de conclusão (chat/treino/palavras novas) ANTES de
// navegar: o toast aparece em qualquer tela que montar o AppShell.
function takePendingUnlocks(): AchievementUnlock[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    sessionStorage.removeItem(STORAGE_KEY);
    const parsed = JSON.parse(raw) as AchievementUnlock[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function AchievementToast() {
  const [current, setCurrent] = useState<AchievementUnlock | null>(null);
  const [queue, setQueue] = useState<AchievementUnlock[]>([]);

  const drain = useCallback(() => {
    setQueue((pending) => {
      if (current) return pending;
      const unlocks = takePendingUnlocks();
      return unlocks.length ? [...pending, ...unlocks] : pending;
    });
  }, [current]);

  useEffect(() => {
    drain();
    // Treinadores setam o storage SEM navegar: o polling cobre esse caso.
    const timer = setInterval(drain, 2000);
    return () => clearInterval(timer);
  }, [drain]);

  useEffect(() => {
    if (current || !queue.length) return;
    const [next, ...rest] = queue;
    setCurrent(next);
    setQueue(rest);
    playSound("achievement");
    vibrate("celebrate");
    const hide = setTimeout(() => setCurrent(null), 4200);
    return () => clearTimeout(hide);
  }, [current, queue]);

  if (!current) return null;

  return <div className="achievement-toast" role="status" aria-live="polite">
    <div className="flashcard-trophy celebrate"><Trophy aria-hidden="true" /></div>
    <div className="row-copy">
      <div className="row-title">Conquista desbloqueada: {current.title}</div>
      <div className="row-meta">{current.description}</div>
    </div>
  </div>;
}
