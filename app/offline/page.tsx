"use client";

import { AppShell } from "@/components/AppShell";
import { TalkitoIcon } from "@/components/TalkitoIcon";

export default function OfflinePage() {
  return (
    <AppShell noNav section="neutral">
      <div className="app-error">
        <TalkitoIcon name="wifi-off" size={40} />
        <h1 className="title">Você está sem conexão</h1>
        <p className="subtitle">Reconecte para continuar. Mensagens não enviadas não são salvas offline.</p>
        <button className="green-button" onClick={() => window.location.reload()} type="button">Tentar novamente</button>
      </div>
    </AppShell>
  );
}
