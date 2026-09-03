import { AppShell } from "@/components/AppShell";
import { LoadingScene } from "@/components/LoadingScene";

export default function Loading() {
  return (
    <AppShell noNav>
      <LoadingScene moment="enter" palette="brand" title="Carregando sua prática" />
    </AppShell>
  );
}
