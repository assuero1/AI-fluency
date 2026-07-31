import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/Skeleton";

export default function Loading() {
  return (
    <AppShell activeNav="calendario" section="calendario">
      <div className="screen-skeleton" aria-busy="true">
        <Skeleton variant="line" width="55%" height={30} />
        <Skeleton variant="card" height={300} />
        <Skeleton variant="card" height={130} />
        <Skeleton variant="card" height={130} />
      </div>
    </AppShell>
  );
}
