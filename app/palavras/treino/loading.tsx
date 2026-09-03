import { AppShell } from "@/components/AppShell";
import { LoadingScene } from "@/components/LoadingScene";

export default function Loading() {
  return (
    <AppShell activeNav="palavras" section="palavras" noNav>
      <LoadingScene moment="enter" palette="palavras" title="Montando seu treino" />
    </AppShell>
  );
}
