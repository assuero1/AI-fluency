import { Lock, Trophy } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { getSessionUser } from "@/lib/learning/profile";
import { getAchievementsSummary } from "@/lib/learning/achievements";

export const dynamic = "force-dynamic";

export default async function AchievementsPage() {
  const user = await getSessionUser();
  const rows = await getAchievementsSummary(user.id);
  const unlockedCount = rows.filter((row) => row.unlockedAt).length;
  // A conquista bloqueada mais próxima de desbloquear merece o destaque.
  const featured = rows
    .filter((row) => !row.unlockedAt && row.progress && row.progress.target > 0)
    .map((row) => ({ row, pct: Math.min(1, row.progress!.current / row.progress!.target) }))
    .sort((a, b) => b.pct - a.pct)[0];

  return (
    <AppShell activeNav="perfil" section="neutral">
      <BackButton href="/perfil" label="Voltar ao perfil" />
      <ScreenHeader
        title="Conquistas"
        subtitle={`${unlockedCount} de ${rows.length} desbloqueadas`}
      />
      {featured ? (
        <section className="achievement-featured" aria-label="Próxima conquista">
          <span className="achievement-featured-label">A sua próxima</span>
          <div className="achievement-featured-body">
            <ProgressRing current={featured.row.progress!.current} target={featured.row.progress!.target} size={56} />
            <div>
              <div className="row-title">{featured.row.title}</div>
              <div className="row-meta">
                {featured.row.progress!.current} de {featured.row.progress!.target} · {Math.round(featured.pct * 100)}%
              </div>
            </div>
          </div>
        </section>
      ) : null}
      <section className="section">
        <div className="row-list">
          {rows.map((row) => (
            <div className={`list-row${row.unlockedAt ? "" : " achievement-locked"}`} key={row.key}>
              <span className={`icon-circle ${row.unlockedAt ? "green" : ""}`}>
                {row.unlockedAt ? <Trophy aria-hidden="true" size={24} /> : <Lock aria-hidden="true" size={24} />}
              </span>
              <div className="row-copy">
                <div className="row-title">{row.title}</div>
                <div className="row-meta">
                  {row.unlockedAt
                    ? `Desbloqueada em ${formatDate(row.unlockedAt)}`
                    : row.progress && row.progress.target > 0
                      ? `${row.description} · ${Math.min(row.progress.current, row.progress.target)} de ${row.progress.target}`
                      : row.description}
                </div>
              </div>
              {!row.unlockedAt && row.progress && row.progress.target > 0 ? (
                <ProgressRing current={row.progress.current} target={row.progress.target} size={36} />
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}

/** Anel de progresso (SVG puro, server-safe): traço da seção sobre hairline. */
function ProgressRing({ current, target, size }: { current: number; target: number; size: number }) {
  const pct = Math.max(0, Math.min(1, target > 0 ? current / target : 0));
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(pct * 100)}% concluído`}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--line-soft)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--section-text)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - pct)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}
