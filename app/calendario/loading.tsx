import { AppShell } from "@/components/AppShell";
import { LoadingScene } from "@/components/LoadingScene";

export default function Loading() {
  return (
    <AppShell activeNav="calendario" section="calendario">
      <LoadingScene moment="enter" palette="calendario" title="Carregando calendário" />
    </AppShell>
  );
}
