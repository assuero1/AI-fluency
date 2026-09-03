"use client";

import { useEffect } from "react";
import { burstConfetti } from "@/lib/client/confetti";

export function ResumoConfetti() {
  useEffect(() => { burstConfetti({ particles: 90 }); }, []);
  return null;
}
