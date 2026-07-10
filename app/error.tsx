"use client";

import { RefreshCw } from "lucide-react";
import { AppShell } from "@/components/AppShell";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <AppShell noNav>
      <div className="app-error" role="alert">
        <h1 className="title">Não foi possível carregar agora</h1>
        <p className="subtitle">Verifique sua conexão e tente novamente.</p>
        <button className="dark-button" onClick={reset} type="button">
          <RefreshCw /> Tentar novamente
        </button>
      </div>
    </AppShell>
  );
}
