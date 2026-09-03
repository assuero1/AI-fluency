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

  return (
    <AppShell activeNav="perfil" section="neutral">
      <ScreenHeader
        title="Conquistas"
        subtitle={`${unlockedCount} de ${rows.length} desbloqueadas`}
      />
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
                    : row.description}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="choice-list">
        <BackButton href="/perfil" label="Voltar ao perfil" />
      </div>
    </AppShell>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" }).format(date);
}
