"use client";

import { useEffect } from "react";
import { Flame } from "lucide-react";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";
import { ModalDialog } from "./ModalDialog";

export function MilestoneModal({ streak, onAck }: { streak: number; onAck: () => void }) {
  useEffect(() => {
    playSound("achievement");
    vibrate("celebrate");
    burstConfetti({ particles: 150 });
  }, []);

  return (
    <ModalDialog className="milestone-modal" onClose={onAck} titleId="milestone-title">
      <div className="flashcard-trophy celebrate"><Flame size={24} /></div>
      <h2 className="section-title" id="milestone-title">{streak} dias seguidos!</h2>
      <p className="row-meta">Sua constância está construindo fluência. Continue assim!</p>
      <button className="green-button full-button" data-autofocus onClick={onAck} type="button">Vamos nessa!</button>
    </ModalDialog>
  );
}
