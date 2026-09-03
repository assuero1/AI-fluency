import { AppShell } from "@/components/AppShell";
import { LoadingScene } from "@/components/LoadingScene";

export default function Loading() {
  return (
    <AppShell section="progresso">
      <LoadingScene moment="enter" palette="progresso" title="Carregando progresso" />
    </AppShell>
  );
}
