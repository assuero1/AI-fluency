"use client";

import { useEffect } from "react";
import { AppShell } from "@/components/AppShell";
import { TalkitoIcon } from "@/components/TalkitoIcon";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <AppShell noNav section="neutral">
      <div className="app-error" role="alert">
        <h1 className="title">Não foi possível carregar agora</h1>
        <p className="subtitle">Verifique sua conexão e tente novamente.</p>
        <button className="dark-button" onClick={reset} type="button">
          <TalkitoIcon name="refresh" size={18} /> Tentar novamente
        </button>
      </div>
    </AppShell>
  );
}
