"use client";

import { Check, Download, Loader2, ShieldAlert, Trash2, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconBubble } from "./IconBubble";
import { LevelPills } from "./LevelPills";
import { ModalDialog } from "./ModalDialog";
import { isHapticsEnabled, setHapticsEnabled } from "@/lib/client/haptics";
import { isSoundEnabled, setSoundEnabled } from "@/lib/client/ui-sound";
import { DEFAULT_LANGUAGE_LEVEL } from "@/lib/learning/levels";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";
import { DAILY_GOAL_OPTIONS } from "@/lib/learning/daily-goal";

type ProfilePreferencesProps = {
  initial: {
    user: { name: string; timezone: string; activeLanguageId: string; dailyGoalMinutes?: number; reminderHour?: number | null };
    activeProfile: {
      id: string;
      languageName: string;
      level: string;
      correctionStyle: string;
      transcriptEnabled: boolean;
      calendarMemoryEnabled: boolean;
    } | null;
    languageProfiles: Array<{ id: string; languageName: string; level: string }>;
  };
  streak: number;
};

const correctionOptions = [
  { value: "Corrigir sempre", meta: "explica o erro durante a conversa" },
  { value: "Corrigir no final", meta: "mantém o fluxo mais natural" },
  { value: "Só quando eu pedir", meta: "modo conversa livre" }
];

const NAME_SAVE_DELAY_MS = 800;

export function ProfilePreferences({ initial, streak }: ProfilePreferencesProps) {
  const router = useRouter();
  const [name, setName] = useState(initial.user.name);
  const [activeLanguageId, setActiveLanguageId] = useState(initial.user.activeLanguageId);
  const dailyGoalOptions = DAILY_GOAL_OPTIONS;
  const [preferences, setPreferences] = useState({
    level: initial.activeProfile?.level ?? DEFAULT_LANGUAGE_LEVEL,
    correctionStyle: initial.activeProfile?.correctionStyle ?? "Corrigir sempre",
    transcriptEnabled: initial.activeProfile?.transcriptEnabled ?? true,
    calendarMemoryEnabled: initial.activeProfile?.calendarMemoryEnabled ?? true,
    dailyGoalMinutes: initial.user.dailyGoalMinutes ?? 15,
    reminderHour: initial.user.reminderHour ?? null
  });
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteChallenge, setDeleteChallenge] = useState<{ token: string; phrase: string } | null>(null);
  const [deletePhrase, setDeletePhrase] = useState("");
  const [nameStatus, setNameStatus] = useState<"idle" | "saving" | "saved">("idle");
  // Preferências de som/vibração vivem no dispositivo (localStorage). O valor
  // inicial sincroniza após a montagem para casar com o HTML do servidor.
  const [soundEnabled, setSoundEnabledState] = useState(true);
  const [hapticsEnabled, setHapticsEnabledState] = useState(true);
  const savedNameRef = useRef(initial.user.name.trim());
  const nameSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (nameSaveTimerRef.current) clearTimeout(nameSaveTimerRef.current);
  }, []);

  useEffect(() => {
    setSoundEnabledState(isSoundEnabled());
    setHapticsEnabledState(isHapticsEnabled());
  }, []);

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

  // Auto-save do nome: dispara ao parar de digitar (debounce) ou ao sair do
  // campo (blur). Nome vazio ou inalterado não gera request.
  async function saveName(nextName: string) {
    const clean = nextName.trim();
    if (!clean || clean === savedNameRef.current) {
      setNameStatus("idle");
      return;
    }
    setNameStatus("saving");
    setError(null);
    try {
      await request("/api/profile", "PATCH", { name: clean });
      savedNameRef.current = clean;
      setNameStatus("saved");
      router.refresh();
    } catch (requestError) {
      setNameStatus("idle");
      setError(messageFrom(requestError));
    }
  }

  function handleNameChange(value: string) {
    setName(value);
    setNameStatus("idle");
    if (nameSaveTimerRef.current) clearTimeout(nameSaveTimerRef.current);
    nameSaveTimerRef.current = setTimeout(() => void saveName(value), NAME_SAVE_DELAY_MS);
  }

  function handleNameBlur() {
    if (nameSaveTimerRef.current) {
      clearTimeout(nameSaveTimerRef.current);
      nameSaveTimerRef.current = null;
    }
    void saveName(name);
  }

  async function saveActiveLanguage(nextId: string) {
    const previous = activeLanguageId;
    setActiveLanguageId(nextId);
    setPending("language");
    setError(null);
    try {
      await request("/api/profile", "PATCH", { activeLanguageId: nextId });
      setNotice("Idioma ativo atualizado.");
      router.refresh();
    } catch (requestError) {
      setActiveLanguageId(previous);
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

  // Som e vibração são preferências locais: salvamento imediato, sem botão.
  function handleSoundEnabledChange(checked: boolean) {
    setSoundEnabledState(checked);
    setSoundEnabled(checked);
  }

  function handleHapticsEnabledChange(checked: boolean) {
    setHapticsEnabledState(checked);
    setHapticsEnabled(checked);
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
      <section className="section profile-form">
        <div className="choice-card">
          <IconBubble Icon={UserRound} />
          <div className="row-copy">
            <label className="field-label" htmlFor="profile-name">
              Nome
              {nameStatus === "saving" ? <span className="row-meta"> · salvando…</span> : null}
              {nameStatus === "saved" ? <span className="row-meta"> · salvo</span> : null}
            </label>
            <input
              autoComplete="name"
              id="profile-name"
              className="field-input"
              maxLength={80}
              onBlur={handleNameBlur}
              onChange={(event) => handleNameChange(event.target.value)}
              placeholder="Seu nome"
              value={name}
            />
            <div className="row-meta">
              {activeLanguage?.languageName ?? "Idioma"} · {activeLanguage?.level ?? "Nível"} · 🔥 {formatPracticeStreak(streak)}
            </div>
          </div>
        </div>
        {initial.languageProfiles.length > 0 ? (
          <label className="profile-select-row">
            <span>Idioma ativo</span>
            <select disabled={pending === "language"} onChange={(event) => void saveActiveLanguage(event.target.value)} value={activeLanguageId}>
              {initial.languageProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.languageName} · {profile.level}</option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      {initial.activeProfile ? (
        <section className="section">
          <h2 className="section-title">Qual seu nível?</h2>
          <LevelPills level={preferences.level} onChange={(option) => savePreference({ level: option })} />
        </section>
      ) : null}

      <section className="section">
        <h2 className="section-title">Meta diária de prática</h2>
        <div className="settings-list">
          {dailyGoalOptions.map((option) => (
            <button
              className={preferences.dailyGoalMinutes === option ? "settings-option active" : "settings-option"}
              disabled={pending === "preferences"}
              key={option}
              onClick={() => savePreference({ dailyGoalMinutes: option })}
              type="button"
            >
              {option} min
            </button>
          ))}
        </div>
        <p className="row-meta">Qualquer prática conta: conversa, treino de cards ou palavras novas.</p>
      </section>

      <section className="section">
        <h2 className="section-title">Lembrete diário</h2>
        <label className="profile-select-row">
          <span>Horário do aviso</span>
          <select
            disabled={pending === "preferences"}
            onChange={(event) => savePreference({ reminderHour: event.target.value === "" ? null : Number(event.target.value) })}
            value={preferences.reminderHour ?? ""}
          >
            <option value="">Desativado</option>
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>{String(hour).padStart(2, "0")}:00</option>
            ))}
          </select>
        </label>
        <p className="row-meta">Enviado só nos dias em que você ainda não praticou.</p>
      </section>

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
          <ToggleRow checked={preferences.transcriptEnabled} label="Mostrar transcrição" onChange={(checked) => savePreference({ transcriptEnabled: checked })} />
          <ToggleRow checked={preferences.calendarMemoryEnabled} label="Usar memória do calendário" onChange={(checked) => savePreference({ calendarMemoryEnabled: checked })} />
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Som e vibração</h2>
        <div className="settings-card">
          <ToggleRow checked={soundEnabled} label="Sons do app" onChange={handleSoundEnabledChange} />
          <ToggleRow checked={hapticsEnabled} label="Vibração" onChange={handleHapticsEnabledChange} />
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

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : "Não foi possível concluir a alteração.";
}
