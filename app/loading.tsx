import { AppShell } from "@/components/AppShell";
import { LoadingDots } from "@/components/LoadingDots";

export default function Loading() {
  return (
    <AppShell noNav>
      <div className="app-loading" aria-live="polite">
        <span className="loading-mark" aria-hidden="true" />
        <span>Carregando sua prática</span>
        <LoadingDots srText="Carregando sua prática..." />
      </div>
    </AppShell>
  );
}
