"use client";

import { Check, Download, KeyRound, Loader2, Mic, Server, ShieldAlert, Trash2, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { IconBubble } from "./IconBubble";
import { ModalDialog } from "./ModalDialog";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";

type ProfilePreferencesProps = {
  initial: {
    user: { name: string; timezone: string; activeLanguageId: string };
    activeProfile: {
      id: string;
      languageName: string;
      level: string;
      correctionStyle: string;
      audioEnabled: boolean;
      transcriptEnabled: boolean;
      calendarMemoryEnabled: boolean;
    } | null;
    languageProfiles: Array<{ id: string; languageName: string; level: string }>;
    connections: {
      ai: { configured: boolean };
      teable: { configured: boolean };
      kokoro: { configured: boolean };
    };
  };
  streak: number;
};

const correctionOptions = [
  { value: "Corrigir sempre", meta: "explica o erro durante a conversa" },
  { value: "Corrigir no final", meta: "mantém o fluxo mais natural" },
  { value: "Só quando eu pedir", meta: "modo conversa livre" }
];

export function ProfilePreferences({ initial, streak }: ProfilePreferencesProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.user.name);
  const [activeLanguageId, setActiveLanguageId] = useState(initial.user.activeLanguageId);
  const [preferences, setPreferences] = useState({
    correctionStyle: initial.activeProfile?.correctionStyle ?? "Corrigir sempre",
    audioEnabled: initial.activeProfile?.audioEnabled ?? true,
    transcriptEnabled: initial.activeProfile?.transcriptEnabled ?? true,
    calendarMemoryEnabled: initial.activeProfile?.calendarMemoryEnabled ?? true
  });
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteChallenge, setDeleteChallenge] = useState<{ token: string; phrase: string } | null>(null);
  const [deletePhrase, setDeletePhrase] = useState("");

  async function request(path: string, method: "PATCH" | "POST" | "DELETE", body?: Record<string, unknown>) {
    const response = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = (await response.json()) as { ok?: boolean; error?: string; confirmationToken?: string; confirmationPhrase?: string };
    if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível salvar a alteração.");
    return data;
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("profile");
    setError(null);
    try {
      await request("/api/profile", "PATCH", { name, activeLanguageId });
      setNotice("Perfil atualizado.");
      router.refresh();
    } catch (requestError) {
      setError(messageFrom(requestError));
    } finally {
      setPending(null);
    }
  }

  async function savePreference(next: Partial<typeof preferences>) {
    const previous = preferences;
    const updated = { ...preferences, ...next };
    setPreferences(updated);
    setPending("preferences");
    setError(null);
    try {
      await request("/api/preferences", "PATCH", next);
      setNotice("Preferências atualizadas.");
      router.refresh();
    } catch (requestError) {
      setPreferences(previous);
      setError(messageFrom(requestError));
    } finally {
      setPending(null);
    }
  }

  async function openDeleteConfirmation() {
    setPending("delete-challenge");
    setError(null);
    try {
      const data = await request("/api/data/delete-confirmation", "POST");
      if (!data.confirmationToken || !data.confirmationPhrase) throw new Error("Não foi possível preparar a confirmação.");
      setDeleteChallenge({ token: data.confirmationToken, phrase: data.confirmationPhrase });
      setDeletePhrase("");
    } catch (requestError) {
      setError(messageFrom(requestError));
    } finally {
      setPending(null);
    }
  }

  async function deleteHistory() {
    if (!deleteChallenge) return;
    setPending("delete-history");
    setError(null);
    try {
      await request("/api/data", "DELETE", { confirmationToken: deleteChallenge.token, phrase: deletePhrase });
      setDeleteChallenge(null);
      setNotice(`Histórico de ${activeLanguage?.languageName ?? "este idioma"} removido. Seu perfil, preferências e outros idiomas foram preservados.`);
      router.refresh();
    } catch (requestError) {
      setError(messageFrom(requestError));
    } finally {
      setPending(null);
    }
  }

  const activeLanguage = initial.languageProfiles.find((profile) => profile.id === activeLanguageId) ?? initial.activeProfile;

  return (
    <>
      <form className="section profile-form" onSubmit={saveProfile}>
        <div className="choice-card">
          <IconBubble Icon={UserRound} />
          <div className="row-copy">
            <label className="field-label" htmlFor="profile-name">Nome</label>
            <input id="profile-name" className="field-input" maxLength={80} onChange={(event) => setName(event.target.value)} value={name} />
            <div className="row-meta">
              {activeLanguage?.languageName ?? "Idioma"} · {activeLanguage?.level ?? "Nível"} · 🔥 {formatPracticeStreak(streak)}
            </div>
          </div>
        </div>
        {initial.languageProfiles.length > 0 ? (
          <label className="profile-select-row">
            <span>Idioma ativo</span>
            <select onChange={(event) => setActiveLanguageId(event.target.value)} value={activeLanguageId}>
              {initial.languageProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.languageName} · {profile.level}</option>
              ))}
            </select>
          </label>
        ) : null}
        <button className="outline-button full-button" disabled={pending === "profile"} type="submit">
          {pending === "profile" ? <Loader2 className="spin" /> : null}
          Salvar perfil
        </button>
      </form>

      <section className="section">
        <h2 className="section-title">Como a IA deve te corrigir?</h2>
        <div className="settings-list">
          {correctionOptions.map((option) => (
            <button
              className={preferences.correctionStyle === option.value ? "choice-card active" : "choice-card"}
              aria-pressed={preferences.correctionStyle === option.value}
              disabled={pending === "preferences"}
              key={option.value}
              onClick={() => savePreference({ correctionStyle: option.value })}
              type="button"
            >
              {preferences.correctionStyle === option.value ? <Check aria-hidden="true" color="#217a38" /> : <span aria-hidden="true" className="choice-placeholder" />}
              <span className="row-copy">
                <span className="row-title">{option.value}</span>
                <span className="row-meta">{option.meta}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Áudio e aprendizagem</h2>
        <div className="settings-card">
          <ToggleRow checked={preferences.audioEnabled} label="Ouvir respostas da IA" onChange={(checked) => savePreference({ audioEnabled: checked })} />
          <ToggleRow checked={preferences.transcriptEnabled} label="Mostrar transcrição" onChange={(checked) => savePreference({ transcriptEnabled: checked })} />
          <ToggleRow checked={preferences.calendarMemoryEnabled} label="Usar memória do calendário" onChange={(checked) => savePreference({ calendarMemoryEnabled: checked })} />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Conexões</h2>
        <div className="settings-list">
          <ConnectionLink connected={initial.connections.ai.configured} Icon={KeyRound} label="IA e modelos" tone="primary" />
          <ConnectionLink connected={initial.connections.teable.configured} Icon={Server} label="Teable" tone="info" />
          <ConnectionLink connected={initial.connections.kokoro.configured} Icon={Mic} label="Kokoro voz" tone="warning" />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Seus dados</h2>
        <div className="settings-list">
          <a className="settings-row" href="/api/export">
            <span className="selector-item"><Download color="#2f7edb" /> Exportar dados</span>
            <span className="link-action">JSON</span>
          </a>
          <button className="settings-row destructive-row" disabled={pending === "delete-challenge"} onClick={openDeleteConfirmation} type="button">
            <span className="selector-item"><Trash2 /> Limpar histórico deste idioma</span>
            {pending === "delete-challenge" ? <Loader2 className="spin" /> : <ShieldAlert />}
          </button>
        </div>
      </section>

      {notice ? <div aria-live="polite" className="inline-notice" role="status">{notice}</div> : null}
      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      {deleteChallenge ? (
        <ModalDialog
          busy={pending === "delete-history"}
          descriptionId="delete-description"
          onClose={() => setDeleteChallenge(null)}
          titleId="delete-title"
        >
            <ShieldAlert color="#ef6b57" size={30} />
            <h2 id="delete-title" className="section-title">Limpar histórico de {activeLanguage?.languageName ?? "este idioma"}?</h2>
            <p className="row-meta" id="delete-description">Conversas, correções, palavras, feedbacks e práticas deste idioma serão removidos. Seu perfil, preferências e os outros idiomas serão preservados.</p>
            <label className="field-label" htmlFor="delete-phrase">Digite {deleteChallenge.phrase} para confirmar</label>
            <input data-autofocus id="delete-phrase" className="field-input" onChange={(event) => setDeletePhrase(event.target.value)} value={deletePhrase} />
            <div className="modal-actions">
              <button className="outline-button" disabled={pending === "delete-history"} onClick={() => setDeleteChallenge(null)} type="button">Cancelar</button>
              <button className="danger-button" disabled={pending === "delete-history" || deletePhrase.trim().length === 0} onClick={deleteHistory} type="button">
                {pending === "delete-history" ? <Loader2 className="spin" /> : <Trash2 />}
                Limpar histórico
              </button>
            </div>
        </ModalDialog>
      ) : null}
    </>
  );
}

function ToggleRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="switch-row">
      <span><strong>{label}</strong></span>
      <input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
    </label>
  );
}

function ConnectionLink({ connected, Icon, label, tone }: { connected: boolean; Icon: typeof KeyRound; label: string; tone: "primary" | "warning" | "info" }) {
  return (
    <Link className="settings-row" href="/settings/connections">
      <span className="selector-item"><Icon color={tone === "primary" ? "#2f9d4a" : tone === "info" ? "#2f7edb" : "#e6a400"} /> {label}</span>
      <span className={connected ? "status-dot" : "status-dot warning-status"}>{connected ? "Configurado" : "Configurar"}</span>
    </Link>
  );
}

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a alteração.";
}
