"use client";

import { ArrowLeft, Loader2, Mic, MicOff, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  newWordsSessionSizes,
  type JudgedTranslation,
  type NewWordPreview,
  type NewWordsSentence,
  type NewWordsSessionResult
} from "@/lib/learning/new-words-contracts";
import { unlockAudioForPlayback, requestSpeech, reportVoiceFailure } from "./voice-shared";
import { Pill } from "./Pill";
import { VoiceButton } from "./VoiceButton";

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
type RecognitionConstructor = new () => Recognition;

export function NewWordsTrainer() {
  const [size, setSize] = useState<number>(5);
  const [sessionId, setSessionId] = useState("");
  const [completionId, setCompletionId] = useState("");
  const [sentences, setSentences] = useState<NewWordsSentence[]>([]);
  const [words, setWords] = useState<NewWordPreview[]>([]);
  const [answeredIds, setAnsweredIds] = useState<Set<string>>(new Set());
  const [current, setCurrent] = useState<NewWordsSentence | null>(null);
  const [input, setInput] = useState("");
  const [judgment, setJudgment] = useState<JudgedTranslation | null>(null);
  const [result, setResult] = useState<NewWordsSessionResult | null>(null);
  const [resumable, setResumable] = useState<{ sessionId: string; nextSentenceId: string; answeredCount: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [audioFailed, setAudioFailed] = useState(false);
  const [audioReplayCount, setAudioReplayCount] = useState(0);
  const [usedSpeech, setUsedSpeech] = useState(false);
  const [languageCode, setLanguageCode] = useState("en");
  const [languageName, setLanguageName] = useState("idioma estudado");
  const [startedAt, setStartedAt] = useState(0);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  useEffect(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    void (async () => {
      try {
        const response = await fetch("/api/practice/new-words", { cache: "no-store" });
        const data = await response.json() as { ok?: boolean; activeSession?: { sessionId: string; nextSentenceId: string; answeredCount: number; languageCode: string; languageName: string } | null };
        if (response.ok && data.ok && data.activeSession && data.activeSession.nextSentenceId) {
          setResumable(data.activeSession);
          setLanguageCode(data.activeSession.languageCode ?? "en");
          setLanguageName(data.activeSession.languageName ?? "idioma estudado");
        }
      } catch { /* overview é best-effort */ }
    })();
    return () => { recognitionRef.current?.abort(); recognitionRef.current = null; };
  }, []);

  // Autoplay da frase corrente: um único <audio> destravado no gesto de iniciar.
  useEffect(() => {
    if (!current || judgment || audioFailed) return;
    let cancelled = false;
    setAudioReplayCount(0);
    (async () => {
      try {
        const audio = audioRef.current;
        if (!audio) return;
        const url = await requestSpeech(current.audioText, languageCode);
        if (cancelled) return;
        if (audio.src !== url) audio.src = url;
        await audio.play();
      } catch {
        if (!cancelled) { setAudioFailed(true); reportVoiceFailure(current.audioText, languageCode, "autoplay-rejected"); }
      }
    })();
    return () => { cancelled = true; };
  }, [current, judgment, audioFailed, languageCode]);

  async function start() {
    setBusy(true); setError("");
    // Destrava o áudio ainda no gesto do clique (iOS): todo autoplay seguinte
    // acontece no mesmo elemento já destravado.
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    unlockAudioForPlayback(audio);
    try {
      const response = await fetch("/api/practice/new-words", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: size }) });
      const data = await response.json() as { ok?: boolean; error?: string; sessionId?: string; sentences?: NewWordsSentence[]; words?: NewWordPreview[]; languageCode?: string; languageName?: string };
      if (!response.ok || !data.ok || !data.sessionId || !data.sentences?.length) throw new Error(data.error ?? "Não foi possível montar a sessão.");
      setSessionId(data.sessionId); setCompletionId(crypto.randomUUID());
      setSentences(data.sentences); setWords(data.words ?? []);
      setAnsweredIds(new Set()); setCurrent(data.sentences[0]); setLanguageCode(data.languageCode ?? "en"); setLanguageName(data.languageName ?? "idioma estudado");
      setResumable(null); setResult(null); resetAttempt();
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Não foi possível montar a sessão."); }
    finally { setBusy(false); }
  }

  async function resume() {
    if (!resumable) return;
    setBusy(true); setError("");
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    unlockAudioForPlayback(audio);
    try {
      const response = await fetch("/api/practice/new-words", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; activeSession?: { sessionId: string; sentences: NewWordsSentence[]; words: NewWordPreview[]; answeredSentenceIds: string[]; nextSentenceId: string; languageCode: string; languageName: string } | null };
      const active = data.activeSession;
      if (!response.ok || !data.ok || !active) throw new Error("Não foi possível retomar a sessão.");
      setSessionId(active.sessionId); setCompletionId(crypto.randomUUID());
      setSentences(active.sentences); setWords(active.words ?? []);
      setAnsweredIds(new Set(active.answeredSentenceIds));
      setCurrent(active.sentences.find((sentence) => sentence.id === active.nextSentenceId) ?? null);
      setLanguageCode(active.languageCode ?? "en"); setLanguageName(active.languageName ?? "idioma estudado");
      setResumable(null); setResult(null); resetAttempt();
    } catch (resumeError) { setError(resumeError instanceof Error ? resumeError.message : "Não foi possível retomar."); }
    finally { setBusy(false); }
  }

  async function submitTranslation(event?: FormEvent) {
    event?.preventDefault();
    if (!current || judgment || busy || !input.trim()) return;
    recognitionRef.current?.stop();
    setBusy(true); setError("");
    const clientAttemptId = crypto.randomUUID();
    try {
      const response = await fetch("/api/practice/new-words/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        sessionId, clientAttemptId, sentenceId: current.id, userTranslation: input.trim(),
        responseTimeMs: Math.max(0, Date.now() - startedAt), usedSpeech, audioReplayCount, audioFailed
      }) });
      const data = await response.json() as { ok?: boolean; error?: string; attempt?: { judgment: JudgedTranslation; senseCreated: boolean } };
      if (!response.ok || !data.ok || !data.attempt) throw new Error(data.error ?? "Não foi possível avaliar a tradução.");
      setJudgment(data.attempt.judgment);
      setAnsweredIds((previous) => new Set([...previous, current.id]));
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Não foi possível avaliar a tradução."); }
    finally { setBusy(false); }
  }

  async function continueToNext() {
    if (!current) return;
    const index = sentences.findIndex((sentence) => sentence.id === current.id);
    const next = sentences[index + 1];
    if (next) { setCurrent(next); resetAttempt(); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/new-words/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, clientCompletionId: completionId }) });
      const data = await response.json() as { ok?: boolean; error?: string } & Partial<NewWordsSessionResult>;
      if (!response.ok || !data.ok || typeof data.score !== "number") throw new Error(data.error ?? "Não foi possível concluir a sessão.");
      setResult(data as NewWordsSessionResult); setCurrent(null); setResumable(null);
    } catch (finishError) { setError(finishError instanceof Error ? finishError.message : "Não foi possível concluir a sessão."); }
    finally { setBusy(false); }
  }

  async function abandonSession() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/new-words/abandon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      if (!response.ok) throw new Error("Não foi possível abandonar a sessão.");
      setSessionId(""); setSentences([]); setCurrent(null); setJudgment(null); setResumable(null); resetAttempt();
    } catch (abandonError) { setError(abandonError instanceof Error ? abandonError.message : "Não foi possível abandonar."); }
    finally { setBusy(false); }
  }

  function resetAttempt() {
    setInput(""); setJudgment(null); setAudioFailed(false); setUsedSpeech(false); setAudioReplayCount(0);
    setError(""); setStartedAt(Date.now());
    setTimeout(() => inputRef.current?.focus(), 0);
  }

  function toggleSpeech() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor();
    recognitionRef.current = recognition;
    recognition.lang = "pt-BR"; recognition.interimResults = true; recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0]?.transcript ?? "";
      setInput(transcript.trim()); setUsedSpeech(true);
    };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; inputRef.current?.focus(); };
    recognition.onerror = () => { setListening(false); setError("Não foi possível transcrever. Digite sua tradução."); };
    setError(""); setListening(true); recognition.start();
  }

  if (result) return <div className="flashcard-screen">
    <audio ref={audioRef} className="sr-only" preload="auto" />
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-result">
      <div className="flashcard-trophy"><Trophy /></div>
      <div className="eyebrow">Sessão concluída</div>
      <h1 className="title">{result.score}% de acerto</h1>
      <p className="subtitle">Você aprendeu {result.wordCount} palavra{result.wordCount === 1 ? "" : "s"} nova{result.wordCount === 1 ? "" : "s"} com {result.sentenceCount} frases.</p>
      <div className="flashcard-result-grid">
        <div><strong>{result.wordCount}</strong><span>palavras novas</span></div>
        <div><strong>{result.correctSentences}/{result.sentenceCount}</strong><span>frases certas</span></div>
        <div><strong>{result.newSensesAdded}</strong><span>novos significados</span></div>
      </div>
      <section className="flashcard-result-details" aria-label="Palavras aprendidas">
        {result.words.map((word) => <div key={word.wordId}><span>{word.lemma}</span><strong>{word.translation}</strong></div>)}
      </section>
      <button className="green-button full-button" onClick={() => { setResult(null); setSentences([]); setWords([]); setAnsweredIds(new Set()); }} type="button"><Sparkles /> Aprender mais palavras</button>
      <Link className="outline-button full-button" href="/palavras">Voltar às palavras</Link>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  </div>;

  if (current) {
    const wordIndex = words.findIndex((word) => word.wordId === current.targetWordId);
    const sentenceOfWord = sentences.filter((sentence) => sentence.targetWordId === current.targetWordId);
    const ordinalOfWord = sentenceOfWord.findIndex((sentence) => sentence.id === current.id) + 1;
    return <div className="flashcard-screen">
      <audio ref={audioRef} className="sr-only" preload="auto" />
      <div className="top-row">
        <button className="back-link button-reset" onClick={() => void abandonSession()} disabled={busy} type="button"><ArrowLeft /> Sair</button>
        <Pill>{answeredIds.size}/{sentences.length} frases{wordIndex >= 0 ? ` · palavra ${wordIndex + 1}/${words.length}` : ""}</Pill>
      </div>
      <div className="progress-line"><span style={{ width: `${(answeredIds.size / Math.max(1, sentences.length)) * 100}%` }} /></div>
      <div className="flashcard-kind"><Pill tone="info">Traduza a frase{sentenceOfWord.length > 1 ? ` (${ordinalOfWord}/${sentenceOfWord.length} desta palavra)` : ""}</Pill></div>
      <section className="active-recall-card" aria-label="Frase para traduzir">
        <span>Traduza para o português</span>
        <strong>{current.sentence}</strong>
        {!audioFailed ? <VoiceButton compact languageCode={languageCode} label="Ouvir novamente" text={current.audioText} onPlayback={() => setAudioReplayCount((count) => count + 1)} onAudioFailure={() => setAudioFailed(true)} /> : <p className="flashcard-audio-fallback" role="status">Áudio indisponível. Continue pelo texto.</p>}
      </section>
      {!judgment ? <form className="flashcard-attempt" onSubmit={submitTranslation}>
        <label htmlFor="new-words-translation">Sua tradução em português</label>
        <div className="flashcard-input-row">
          <input autoComplete="off" id="new-words-translation" maxLength={300} onChange={(event) => setInput(event.target.value)} placeholder="Digite sua tradução" ref={inputRef} value={input} />
          <button aria-label={listening ? "Parar transcrição" : "Falar tradução"} className={listening ? "voice-icon-button listening" : "voice-icon-button"} disabled={!speechSupported} onClick={toggleSpeech} type="button">{listening ? <MicOff /> : <Mic />}</button>
        </div>
        <div className="flashcard-attempt-actions"><button className="green-button" disabled={!input.trim() || busy} type="submit">Traduzir</button></div>
      </form> : <section className="flashcard-reveal" aria-live="polite">
        <div><span>Tradução esperada</span><strong>{judgment.correctedTranslation}</strong></div>
        <div><span>Sua tradução</span><strong>{input}</strong></div>
        <p className={`answer-match ${judgment.verdict === "correct" ? "exact" : judgment.verdict === "acceptable" ? "acceptable" : judgment.verdict}`}>{verdictLabel(judgment.verdict)}</p>
        <p className="row-meta">{judgment.feedback}</p>
        {judgment.newSenseTranslation ? <p className="speech-status">Registrado: “{judgment.newSenseTranslation}” entrou como novo significado desta palavra.</p> : null}
        <div className="recall-rating-grid"><button className="suggested" disabled={busy} onClick={() => void continueToNext()} type="button">Continuar</button></div>
      </section>}
      {busy ? <p className="speech-status"><Loader2 className="spin" /> Salvando...</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>;
  }

  return <div className="flashcard-screen">
    {/* O MESMO elemento <audio> precisa existir em todas as telas: é ele que é
        destravado no gesto de "Começar" e reusado pelo autoplay de cada frase. */}
    <audio ref={audioRef} className="sr-only" preload="auto" />
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-intro">
      <div className="flashcard-brand"><Sparkles /></div>
      <div><div className="eyebrow">Vocabulário novo</div><h1 className="title">Palavras novas</h1><p className="subtitle">A IA escolhe palavras do seu nível, monta frases com o que você já sabe e corrige suas traduções como um professor.</p></div>
    </section>
    {resumable ? <div className="modal-backdrop" role="presentation"><section aria-labelledby="resume-new-words" aria-modal="true" className="confirmation-modal" role="dialog">
      <h2 className="section-title" id="resume-new-words">Sessão em andamento</h2>
      <p className="row-meta">Você já traduziu {resumable.answeredCount} frases desta sessão.</p>
      <div className="flashcard-resume-actions">
        <button className="green-button" disabled={busy} onClick={() => void resume()} type="button">Continuar sessão</button>
        <button className="danger-button" disabled={busy} onClick={() => { setResumable(null); void abandonResumable(resumable.sessionId); }} type="button">Abandonar</button>
      </div>
    </section></div> : null}
    <section className="section">
      <h2 className="section-title">Quantas palavras quer aprender?</h2>
      <div className="flashcard-choice-grid">
        {newWordsSessionSizes.map((option) => (
          <button key={option} className={size === option ? "choice-card active" : "choice-card"} disabled={busy} onClick={() => setSize(option)} type="button">
            <div><strong>{option}</strong><span>palavras · {option * 3} frases</span></div>
          </button>
        ))}
      </div>
      <button className="green-button full-button" disabled={busy} onClick={() => void start()} type="button">
        {busy ? <><Loader2 className="spin" /> Escolhendo palavras e montando frases...</> : <><Sparkles /> Começar com {size} palavra{size === 1 ? "" : "s"}</>}
      </button>
      <p className="row-meta">Cada palavra vem em {3} frases curtas. Ouça, traduza e a IA corrige na hora.</p>
    </section>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;

  async function abandonResumable(targetSessionId: string) {
    setBusy(true);
    try {
      await fetch("/api/practice/new-words/abandon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: targetSessionId }) });
    } finally { setBusy(false); }
  }
}

function verdictLabel(verdict: JudgedTranslation["verdict"]) {
  if (verdict === "correct") return "Tradução correta!";
  if (verdict === "acceptable") return "Correta — com uma nuance diferente";
  if (verdict === "minor_error") return "Quase isso";
  return "Não é essa";
}
