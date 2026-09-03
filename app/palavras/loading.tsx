import { AppShell } from "@/components/AppShell";
import { LoadingScene } from "@/components/LoadingScene";

export default function Loading() {
  return (
    <AppShell activeNav="palavras" section="palavras">
      <LoadingScene moment="enter" palette="palavras" title="Carregando palavras" />
    </AppShell>
  );
}
