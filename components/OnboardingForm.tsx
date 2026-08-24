"use client";

import { ArrowLeft, Check, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { languages } from "@/data/mock";
import { DEFAULT_LANGUAGE_LEVEL, LANGUAGE_LEVELS, LanguageLevel } from "@/lib/learning/levels";
import { LevelPills } from "./LevelPills";
import { Pill } from "./Pill";

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
          {index === languageIndex ? <Check aria-hidden="true" color="#217a38" /> : null}
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

  const selectedLanguage = languages[languageIndex];
  const progress = useMemo(() => {
    const completed = [selectedLanguage, level, goal, correctionStyle].filter(Boolean).length;
    return `${completed} de 4`;
  }, [correctionStyle, goal, level, selectedLanguage]);

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

      router.push(data.redirectTo ?? "/");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Erro inesperado ao salvar.");
    } finally {
      setIsSaving(false);
    }
  }

  if (languageSelectionOnly) {
    return (
      <>
        <div className="top-row">
          <Link aria-label="Voltar para início" className="outline-button icon-button" href="/" title="Voltar para início">
            <ArrowLeft />
          </Link>
          <Pill tone="primary">Idioma de estudo</Pill>
        </div>

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

        <div style={{ marginTop: 32 }}>
          <button className="dark-button full-button" disabled={isSaving} onClick={submit} type="button">
            {isSaving ? <Loader2 className="spin" /> : null}
            {isSaving ? "Trocando idioma..." : `Usar ${selectedLanguage.title}`}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="top-row">
        <Pill>{progress}</Pill>
        <Pill tone="primary">
          <Sparkles size={17} /> IA adaptativa
        </Pill>
      </div>

      <section className="section">
        <h1 className="title">Comece do seu jeito</h1>
        <p className="subtitle">A IA adapta conversas, correções e vocabulário ao seu objetivo.</p>
      </section>

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
                <span className="row-meta">Usado para criar temas, feedbacks e correções.</span>
              </span>
              {option === goal ? <Check aria-hidden="true" color="#217a38" /> : null}
            </button>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Como a IA deve corrigir?</h2>
        <div aria-label="Estilo de correção" className="level-pills" role="group">
          {correctionOptions.map((option) => (
            <button aria-pressed={option === correctionStyle} className="plain-button" key={option} onClick={() => setCorrectionStyle(option)} type="button">
              <Pill tone={option === correctionStyle ? "primary" : "default"}>{option}</Pill>
            </button>
          ))}
        </div>
      </section>

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

      {error ? <div className="inline-error" role="alert">{error}</div> : null}

      <div style={{ marginTop: 32 }}>
        <button className="dark-button full-button" disabled={isSaving || !name.trim()} onClick={submit} type="button">
          {isSaving ? <Loader2 className="spin" /> : null}
          {isSaving ? "Salvando perfil..." : "Salvar e continuar"}
        </button>
      </div>
    </>
  );
}
