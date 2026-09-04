import { ReactNode } from "react";
import { AiModelSelect } from "@/components/AiModelSelect";
import { AppShell } from "@/components/AppShell";
import { BackButton } from "@/components/BackButton";
import { ConnectionTestButton } from "@/components/ConnectionTestButton";
import { IconBubble } from "@/components/IconBubble";
import { Pill } from "@/components/Pill";
import { ScreenHeader } from "@/components/ScreenHeader";
import { TalkitoIconName } from "@/components/TalkitoIcon";
import { getConnectionStatus } from "@/lib/settings/status";

// Connection status depends on server-only environment variables. It must be
// evaluated for each request so a container restart or runtime secret update is
// reflected without baking stale status into the production build.
export const dynamic = "force-dynamic";

function ConnectionCard({
  title,
  meta,
  talkitoIcon,
  tone,
  connected,
  lines,
  testEndpoint,
  children
}: {
  title: string;
  meta: string;
  talkitoIcon: TalkitoIconName;
  tone: "primary" | "warning" | "info";
  connected: boolean;
  lines: Array<{ label: string; value: string }>;
  testEndpoint: string;
  children?: ReactNode;
}) {
  return (
    <div className="card">
      <div className="top-row">
        <div className="selector-item">
          <IconBubble talkitoIcon={talkitoIcon} tone={tone} />
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
        {children}
        <ConnectionTestButton endpoint={testEndpoint} label={title} />
      </div>
    </div>
  );
}

export default async function ConnectionsPage() {
  const status = await getConnectionStatus();

  return (
    <AppShell activeNav="perfil" section="neutral">
      <BackButton href="/perfil" label="Voltar ao perfil" />
      <section className="section">
        <ScreenHeader title="Conexões" subtitle="As chaves ficam no servidor. O app mostra apenas status e máscaras." />
      </section>
      <section className="section choice-list">
        <ConnectionCard
          title="IA de conversa"
          meta="Provider, API key e modelo"
          talkitoIcon="key"
          tone="primary"
          connected={status.ai.configured}
          lines={[
            { label: "Provider", value: status.ai.provider },
            { label: "API key", value: status.ai.apiKeyMasked ?? "não configurada" },
            { label: "Modelo", value: status.ai.chatModel ?? "não configurado" }
          ]}
          testEndpoint="/api/settings/test-ai"
        >
          <AiModelSelect
            aiConfigured={status.ai.configured}
            currentModel={status.ai.chatModel}
            modelSource={status.ai.modelSource}
          />
        </ConnectionCard>
        <ConnectionCard
          title="Supabase"
          meta="URL e service role key"
          talkitoIcon="server"
          tone="info"
          connected={status.supabase.configured}
          lines={[
            { label: "URL", value: status.supabase.urlConfigured ? "configurada" : "não configurada" },
            { label: "Service role key", value: status.supabase.serviceRoleKeyMasked ?? "não configurada" }
          ]}
          testEndpoint="/api/settings/test-supabase"
        />
        <ConnectionCard
          title={status.tts?.provider === "deepinfra" ? "Chatterbox voz" : "Kokoro voz"}
          meta={status.tts?.provider === "deepinfra" ? `DeepInfra (${status.tts.model})` : "VPS (Base URL, API key e voz padrão)"}
          talkitoIcon="microphone"
          tone="warning"
          connected={status.tts?.configured ?? status.kokoro.configured}
          lines={[
            { label: "Provedor", value: status.tts?.provider === "deepinfra" ? "DeepInfra (Chatterbox)" : "Kokoro (VPS)" },
            { label: "API key", value: (status.tts?.apiKeyMasked ?? status.kokoro.apiKeyMasked) ?? "não configurada" },
            { label: "Voz", value: status.tts?.defaultVoice || status.kokoro.defaultVoice },
            { label: "Formato", value: status.tts?.outputFormat || status.kokoro.outputFormat }
          ]}
          testEndpoint="/api/settings/test-tts"
        />
      </section>
    </AppShell>
  );
}
