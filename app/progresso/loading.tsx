import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <AppShell section="progresso">
      <div className="screen-skeleton" aria-busy="true">
        <Skeleton variant="line" width="55%" height={30} />
        <Skeleton variant="card" height={180} />
        <Skeleton variant="card" height={110} />
        <Skeleton variant="line" width="70%" />
        <Skeleton variant="card" height={140} />
      </div>
    </AppShell>
  );
}
