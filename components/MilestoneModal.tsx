"use client";

import { useEffect } from "react";
import { Flame } from "lucide-react";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";

export function MilestoneModal({ streak, onAck }: { streak: number; onAck: () => void }) {
  useEffect(() => {
    playSound("achievement");
    vibrate("celebrate");
    burstConfetti({ particles: 150 });
  }, []);

  return <div className="modal-backdrop" role="presentation">
    <section aria-labelledby="milestone-title" aria-modal="true" className="confirmation-modal milestone-modal" role="dialog">
      <div className="flashcard-trophy celebrate"><Flame /></div>
      <h2 className="section-title" id="milestone-title">{streak} dias seguidos! 🔥</h2>
      <p className="row-meta">Sua constância está construindo fluência. Continue assim!</p>
      <button className="green-button full-button" onClick={onAck} type="button">Vamos nessa!</button>
    </section>
  </div>;
}
