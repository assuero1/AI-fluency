import Link from "next/link";
import { AppShell } from "@/components/AppShell";

export default function NotFoundPage() {
  return (
    <AppShell noNav>
      <div className="app-error">
        <h1 className="title">Página não encontrada</h1>
        <p className="subtitle">O endereço que você tentou abrir não existe ou foi movido.</p>
        <Link className="green-button" href="/">Voltar ao início</Link>
      </div>
    </AppShell>
  );
}
