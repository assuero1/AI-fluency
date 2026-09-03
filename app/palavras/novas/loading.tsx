import { AppShell } from "@/components/AppShell";
import { LoadingScene } from "@/components/LoadingScene";

export default function Loading() {
  return (
    <AppShell activeNav="novas" section="novas" noNav>
      <LoadingScene moment="enter" palette="palavras" title="Preparando suas frases" />
    </AppShell>
  );
}
