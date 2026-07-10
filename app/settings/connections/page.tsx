import { ChevronLeft, KeyRound, Mic, Server } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { ConnectionTestButton } from "@/components/ConnectionTestButton";
import { IconBubble } from "@/components/IconBubble";
import { Pill } from "@/components/Pill";
import { getConnectionStatus } from "@/lib/settings/status";

// Connection status depends on server-only environment variables. It must be
// evaluated for each request so a container restart or runtime secret update is
// reflected without baking stale status into the production build.
export const dynamic = "force-dynamic";

function ConnectionCard({
  title,
  meta,
  Icon,
  tone,
  connected,
  lines,
  testEndpoint
}: {
  title: string;
  meta: string;
  Icon: typeof KeyRound;
  tone: "primary" | "warning" | "info";
  connected: boolean;
  lines: Array<{ label: string; value: string }>;
  testEndpoint: string;
}) {
  return (
    <div className="soft-card" style={{ background: "#fff", border: "1px solid var(--line)" }}>
      <div className="top-row">
        <div className="selector-item">
          <IconBubble Icon={Icon} tone={tone} />
          <div>
            <div className="row-title">{title}</div>
            <div className="row-meta">{meta}</div>
          </div>
        </div>
        <Pill tone={connected ? "primary" : "warning"}>{connected ? "Configurado" : "Configurar"}</Pill>
      </div>
      <div className="choice-list">
        {lines.map((line) => (
          <div className="settings-row" key={line.label}>
            <span>{line.label}</span>
            <span className="muted">{line.value}</span>
          </div>
        ))}
        <ConnectionTestButton endpoint={testEndpoint} label={title} />
      </div>
    </div>
  );
}

export default function ConnectionsPage() {
  const status = getConnectionStatus();

  return (
    <AppShell activeNav="perfil">
      <div className="top-row">
        <Link className="outline-button" href="/perfil" aria-label="Voltar">
          <ChevronLeft />
        </Link>
        <Pill>Conexões</Pill>
      </div>
      <section className="section">
        <h1 className="title">IA, Teable e Kokoro</h1>
        <p className="subtitle">As chaves ficam no servidor. O app mostra apenas status e máscaras.</p>
      </section>
      <section className="section choice-list">
        <ConnectionCard
          title="IA de conversa"
          meta="Provider, API key e modelo"
          Icon={KeyRound}
          tone="primary"
          connected={status.ai.configured}
          lines={[
            { label: "Provider", value: status.ai.provider },
            { label: "API key", value: status.ai.apiKeyMasked ?? "não configurada" },
            { label: "Modelo", value: status.ai.chatModel ?? "não configurado" }
          ]}
          testEndpoint="/api/settings/test-ai"
        />
        <ConnectionCard
          title="Teable"
          meta="Base URL, API key e base ID"
          Icon={Server}
          tone="info"
          connected={status.teable.configured}
          lines={[
            { label: "API key", value: status.teable.apiKeyMasked ?? "não configurada" },
            { label: "Tabelas mapeadas", value: `${status.teable.mappedTableCount}/${status.teable.totalTableCount}` },
            { label: "Health table", value: status.teable.healthTableConfigured ? "configurada" : "não configurada" }
          ]}
          testEndpoint="/api/settings/test-teable"
        />
        <ConnectionCard
          title="Kokoro voz"
          meta="Base URL, API key e voz padrão"
          Icon={Mic}
          tone="warning"
          connected={status.kokoro.configured}
          lines={[
            { label: "API key", value: status.kokoro.apiKeyMasked ?? "não configurada" },
            { label: "Voz", value: status.kokoro.defaultVoice },
            { label: "Formato", value: status.kokoro.outputFormat }
          ]}
          testEndpoint="/api/settings/test-kokoro"
        />
      </section>
      <Link className="dark-button full-button" href="/perfil">
        Voltar ao perfil
      </Link>
    </AppShell>
  );
}
