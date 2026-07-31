import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <AppShell activeNav="palavras" section="palavras">
      <div className="screen-skeleton" aria-busy="true">
        <Skeleton variant="line" width="55%" height={30} />
        <Skeleton variant="card" height={140} />
        <Skeleton variant="line" width="80%" />
        <Skeleton variant="card" height={220} />
        <Skeleton variant="line" width="45%" />
      </div>
    </AppShell>
  );
}
