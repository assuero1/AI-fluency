"use client";

import { Check, Mic, PartyPopper, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { languages } from "@/data/mock";
import { DEFAULT_LANGUAGE_LEVEL, LANGUAGE_LEVELS, LanguageLevel } from "@/lib/learning/levels";
import { BackButton } from "./BackButton";
import { LoadingScene } from "./LoadingScene";
import { LevelPills } from "./LevelPills";
import { Pill } from "./Pill";
import { burstConfetti } from "@/lib/client/confetti";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";

const correctionOptions = ["Corrigir sempre", "Corrigir no final", "Só quando eu pedir"];
const goals = [
  "Falar com mais naturalidade em situações reais.",
  "Melhorar conversas de trabalho e reuniões.",
  "Viajar com mais confiança.",
  "Aumentar vocabulário e corrigir erros recorrentes."
];

type InitialProfile = {
  languageCode: string;
  languageName: string;
  level: string;
  learningGoal: string;
  correctionStyle: string;
  audioEnabled: boolean;
  transcriptEnabled: boolean;
  calendarMemoryEnabled: boolean;
  weeklyConversationGoal: number;
  weeklyWordGoal: number;
};

function languageCode(label: string) {
  const map: Record<string, string> = {
    EN: "en",
    ES: "es",
    FR: "fr",
    IT: "it"
  };
  return map[label] ?? label.toLowerCase();
}

function languageIndexFromCode(code?: string) {
  const index = languages.findIndex((language) => languageCode(language.code) === code?.toLowerCase());
  return index >= 0 ? index : 0;
}

function LanguageChoices({ languageIndex, onSelect }: { languageIndex: number; onSelect: (index: number) => void }) {
  return (
    <div aria-label="Idioma de estudo" className="choice-list" role="group">
      {languages.map((language, index) => (
        <button
          className={index === languageIndex ? "choice-card active" : "choice-card"}
          aria-pressed={index === languageIndex}
          key={language.code}
          onClick={() => onSelect(index)}
          type="button"
        >
          <span className="selector-item">
            <span className="flag">{language.code}</span>
          </span>
          <span className="row-copy">
            <span className="row-title">{language.title}</span>
            <span className="row-meta">{language.meta}</span>
          </span>
          {index === languageIndex ? <Check aria-hidden="true" className="text-accent" /> : null}
        </button>
      ))}
    </div>
  );
}

export function OnboardingForm({
  initialProfile = null,
  languageSelectionOnly = false,
  profileLevels = []
}: {
  initialProfile?: InitialProfile | null;
  languageSelectionOnly?: boolean;
  profileLevels?: Array<{ languageCode: string; level: string }>;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [languageIndex, setLanguageIndex] = useState(() => languageIndexFromCode(initialProfile?.languageCode));
  const [level, setLevel] = useState(initialProfile?.level ?? DEFAULT_LANGUAGE_LEVEL);
  const [goal, setGoal] = useState(initialProfile?.learningGoal ?? goals[0]);
  const [correctionStyle, setCorrectionStyle] = useState(initialProfile?.correctionStyle ?? "Corrigir sempre");
  const [audioEnabled, setAudioEnabled] = useState(initialProfile?.audioEnabled ?? true);
  const [transcriptEnabled, setTranscriptEnabled] = useState(initialProfile?.transcriptEnabled ?? true);
  const [calendarMemoryEnabled, setCalendarMemoryEnabled] = useState(initialProfile?.calendarMemoryEnabled ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Wizard: 3 passos + tela de celebração (só no onboarding completo).
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [done, setDone] = useState(false);
  const [startingChat, setStartingChat] = useState(false);

  const selectedLanguage = languages[languageIndex];

  function selectLanguage(index: number) {
    setLanguageIndex(index);
    const code = languageCode(languages[index].code);
    const saved = profileLevels.find((item) => item.languageCode.toLowerCase() === code);
    if (saved && (LANGUAGE_LEVELS as readonly string[]).includes(saved.level) && level !== saved.level) setLevel(saved.level);
  }

  async function submit() {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Só envia nome no onboarding completo; ao trocar de idioma o nome
          // existente é preservado (antes era reescrito com um valor fixo).
          name: languageSelectionOnly ? undefined : name.trim(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language_code: languageCode(selectedLanguage.code),
          language_name: selectedLanguage.title,
          level,
          learning_goal: goal,
          correction_style: correctionStyle,
          audio_enabled: audioEnabled,
          transcript_enabled: transcriptEnabled,
          calendar_memory_enabled: calendarMemoryEnabled,
          weekly_conversation_goal: initialProfile?.weeklyConversationGoal ?? 7,
          weekly_word_goal: initialProfile?.weeklyWordGoal ?? 500,
          mode: languageSelectionOnly ? "language" : "onboarding"
        })
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível salvar seu perfil.");

      if (languageSelectionOnly) {
        router.push(data.redirectTo ?? "/");
        router.refresh();
        return;
      }
      // Onboarding completo: celebra antes de navegar — o CTA final cria a
      // primeira conversa (time-to-aha rápido) ou leva à Home.
      setDone(true);
      playSound("achievement");
      vibrate("celebrate");
      burstConfetti({ particles: 130 });
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Erro inesperado ao salvar.");
    } finally {
      setIsSaving(false);
    }
  }

  async function startFirstConversation() {
    setStartingChat(true);
    try {
      const response = await fetch("/api/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "free_conversation", title: "Conversa livre" })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível iniciar a conversa.");
      router.push(data.redirectTo ?? "/chat");
    } catch {
      router.push("/");
    } finally {
      setStartingChat(false);
    }
  }

  if (languageSelectionOnly) {
    return (
      <>
        <BackButton href="/" label="Voltar ao início" />

        <section className="section">
          <h1 className="title">Escolha o idioma</h1>
          <p className="subtitle">Seu progresso, palavras e feedbacks ficam organizados por idioma.</p>
        </section>

        <section className="section">
          <LanguageChoices languageIndex={languageIndex} onSelect={selectLanguage} />
        </section>

        <section className="section">
          <h2 className="section-title">Qual seu nível?</h2>
          <LevelPills level={level} onChange={(option: LanguageLevel) => setLevel(option)} />
        </section>

        {error ? <div className="inline-error" role="alert">{error}</div> : null}

        <div className="section">
          <button className="green-button full-button" disabled={isSaving} onClick={submit} type="button">
            {isSaving ? "Trocando idioma..." : `Usar ${selectedLanguage.title}`}
          </button>
        </div>
        {isSaving ? <LoadingScene variant="overlay" moment="save" palette="neutral" title="Trocando idioma..." /> : null}
      </>
    );
  }

  const firstName = name.trim().split(/\s+/)[0] || "tudo pronto";

  if (done) {
    return (
      <section className="section onboarding-celebration">
        <div className="flashcard-trophy celebrate"><PartyPopper aria-hidden="true" size={24} /></div>
        <h1 className="title">Perfil pronto, {firstName}!</h1>
        <p className="subtitle">Em 1 minuto você faz sua primeira conversa — a IA ajusta tudo ao seu nível.</p>
        <button className="green-button full-button" disabled={startingChat} onClick={() => void startFirstConversation()} type="button">
          <Mic /> Fazer minha primeira conversa
        </button>
        {startingChat ? <LoadingScene variant="overlay" moment="enter" palette="neutral" title="Preparando sua primeira conversa..." /> : null}
        <Link className="outline-button full-button" href="/">Explorar o app</Link>
      </section>
    );
  }

  const canContinue = step === 1 ? Boolean(name.trim()) : true;

  return (
    <>
      <div className="top-row">
        <Pill>Passo {step} de 3</Pill>
        <Pill tone="primary">
          <Sparkles size={16} /> IA adaptativa
        </Pill>
      </div>
      <div className="progress-line" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-label={`Passo ${step} de 3`}>
        <span style={{ width: `${Math.round((step / 3) * 100)}%` }} />
      </div>

      <section className="section">
        <h1 className="title">Comece do seu jeito</h1>
        <p className="subtitle">A IA adapta conversas, correções e vocabulário ao seu objetivo.</p>
      </section>

      {step === 1 ? (
        <>
          <section className="section">
            <h2 className="section-title">Como podemos te chamar?</h2>
            <input
              autoComplete="name"
              className="field-input"
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
              placeholder="Seu nome"
              value={name}
            />
          </section>

          <section className="section">
            <h2 className="section-title">Escolha o idioma</h2>
            <LanguageChoices languageIndex={languageIndex} onSelect={selectLanguage} />
          </section>

          <section className="section">
            <h2 className="section-title">Qual seu nível?</h2>
            <LevelPills level={level} onChange={(option: LanguageLevel) => setLevel(option)} />
          </section>
        </>
      ) : null}

      {step === 2 ? (
        <>
          <section className="section">
            <h2 className="section-title">Qual é o foco agora?</h2>
            <div aria-label="Objetivo de aprendizagem" className="choice-list compact" role="group">
              {goals.map((option) => (
                <button
                  className={option === goal ? "choice-card active" : "choice-card"}
                  aria-pressed={option === goal}
                  key={option}
                  onClick={() => setGoal(option)}
                  type="button"
                >
                  <span className="row-copy">
                    <span className="row-title">{option}</span>
                  </span>
                  {option === goal ? <Check aria-hidden="true" className="text-accent" /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="section">
            <h2 className="section-title">Como a IA deve corrigir?</h2>
            <div aria-label="Estilo de correção" className="choice-list compact" role="group">
              {correctionOptions.map((option) => (
                <button
                  aria-pressed={option === correctionStyle}
                  className={option === correctionStyle ? "choice-card active" : "choice-card"}
                  key={option}
                  onClick={() => setCorrectionStyle(option)}
                  type="button"
                >
                  <span className="row-copy">
                    <span className="row-title">{option}</span>
                  </span>
                  {option === correctionStyle ? <Check aria-hidden="true" className="text-accent" /> : null}
                </button>
              ))}
            </div>
          </section>
        </>
      ) : null}

      {step === 3 ? (
        <section className="section">
          <h2 className="section-title">Preferências iniciais</h2>
          <div className="settings-card">
            <label className="switch-row">
              <span>
                <strong>Áudio da IA</strong>
                <small>Kokoro lê perguntas e explicações.</small>
              </span>
              <input checked={audioEnabled} onChange={(event) => setAudioEnabled(event.target.checked)} type="checkbox" />
            </label>
            <label className="switch-row">
              <span>
                <strong>Mostrar transcrição</strong>
                <small>Você lê junto enquanto escuta.</small>
              </span>
              <input
                checked={transcriptEnabled}
                onChange={(event) => setTranscriptEnabled(event.target.checked)}
                type="checkbox"
              />
            </label>
            <label className="switch-row">
              <span>
                <strong>Memória do calendário</strong>
                <small>A IA usa feedbacks passados para sugerir temas.</small>
              </span>
              <input
                checked={calendarMemoryEnabled}
                onChange={(event) => setCalendarMemoryEnabled(event.target.checked)}
                type="checkbox"
              />
            </label>
          </div>
        </section>
      ) : null}

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      <div className="section">
        <div className="choice-actions">
          {step > 1 ? (
            <button className="outline-button" disabled={isSaving} onClick={() => setStep((current) => (current - 1) as 1 | 2)} type="button">
              Voltar
            </button>
          ) : null}
          {step < 3 ? (
            <button className="green-button full-button" disabled={!canContinue} onClick={() => setStep((current) => (current + 1) as 2 | 3)} type="button">
              Continuar
            </button>
          ) : (
            <button className="green-button full-button" disabled={isSaving || !name.trim()} onClick={submit} type="button">
              {isSaving ? "Salvando perfil..." : "Salvar e continuar"}
            </button>
          )}
        </div>
        {isSaving ? <LoadingScene variant="overlay" moment="save" palette="neutral" title="Salvando seu perfil..." /> : null}
      </div>
    </>
  );
}
