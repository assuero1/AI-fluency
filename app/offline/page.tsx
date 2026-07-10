import { WifiOff } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function OfflinePage() {
  return (
    <AppShell noNav>
      <div className="app-error">
        <WifiOff size={34} color="#2f9d4a" />
        <h1 className="title">Você está sem conexão</h1>
        <p className="subtitle">Reconecte para continuar. Mensagens não enviadas não são salvas offline.</p>
        <Link className="green-button" href="/">Tentar novamente</Link>
      </div>
    </AppShell>
  );
}
