import { AppShell } from "@/components/AppShell";

export default function Loading() {
  return (
    <AppShell noNav>
      <div className="app-loading" aria-live="polite">
        <span className="loading-mark" />
        <span>Carregando sua prática...</span>
      </div>
    </AppShell>
  );
}
