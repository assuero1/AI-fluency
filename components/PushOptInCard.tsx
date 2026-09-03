"use client";

import { BellRing } from "lucide-react";
import { useState } from "react";
import { IconBubble } from "./IconBubble";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

type PushOptInCardProps = {
  show: boolean;
  onDone?: () => void;
};

// Opt-in contextual: aparece DEPOIS de a pessoa já ter concluído 2 sessões
// (nunca no primeiro contato). O app manda no máximo 1 aviso por dia e só
// quando a prática do dia ainda não aconteceu.
export function PushOptInCard({ show, onDone }: PushOptInCardProps) {
  const [state, setState] = useState<"idle" | "busy" | "granted" | "denied">("idle");

  if (!show || typeof Notification === "undefined" || Notification.permission !== "default") return null;

  async function enable() {
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setState("denied"); return; }
      const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!vapidKey) throw new Error("Push não configurado.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey)
      });
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      const response = await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...json, reminderHour: new Date().getHours() })
      });
      if (!response.ok) throw new Error("subscribe failed");
      setState("granted");
      onDone?.();
    } catch {
      setState("denied");
    }
  }

  return <section className="section home-today" aria-label="Lembretes de prática">
    <div className="card-heading">
      <IconBubble Icon={BellRing} tone="warning" />
      <div className="row-copy">
        <h2 className="row-title">Aviso para manter a sequência?</h2>
        <p className="row-meta">1x por dia, só quando você ainda não praticou.</p>
      </div>
    </div>
    {state === "granted" ? (
      <p className="row-meta text-accent">Pronto! Avisaremos amanhã, se precisar.</p>
    ) : state === "denied" ? (
      <p className="row-meta">Sem problema — você pode ativar depois no Perfil.</p>
    ) : (
      <button className="green-button full-button" disabled={state === "busy"} onClick={() => void enable()} type="button">
        <BellRing /> Quero o lembrete
      </button>
    )}
  </section>;
}
