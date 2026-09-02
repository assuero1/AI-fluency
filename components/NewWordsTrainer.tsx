"use client";

import { ArrowLeft, Loader2, Mic, MicOff, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  newWordsSessionSizes,
  SENTENCES_PER_WORD,
  splitSentenceAroundTarget,
  type ActiveNewWordsPractice,
  type JudgedTranslation,
  type NewWordPreview,
  type NewWordsSentence,
  type NewWordsSessionResult
} from "@/lib/learning/new-words-contracts";
import { unlockAudioForPlayback, requestSpeech, reportVoiceFailure } from "./voice-shared";
import { createAudioPrefetchQueue, type AudioPrefetchQueue } from "@/lib/learning/audio-prefetch";
import { compareFlashcardAnswer } from "@/lib/learning/flashcard-answer";
import { playButtonSound } from "@/lib/client/ui-sound";
import { AppShell } from "./AppShell";
import { Pill } from "./Pill";
import { VoiceButton } from "./VoiceButton";

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; abort(): void; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
type RecognitionConstructor = new () => Recognition;

type ReadyNewWordsSession = Extract<ActiveNewWordsPractice, { preparing: false; failed?: false }>;

// Criação assíncrona: o POST devolve a sessão em "preparing" e o deck é gerado
// em background; o GET é consultado em ritmo fixo até ficar pronto (40 tentativas
// de 2,5s ≈ 100s cobrem a geração típica de 15–40s com folga).
const POLL_INTERVAL_MS = 2500;
const MAX_POLL_ATTEMPTS = 40;
const PREPARING_ERROR = "Não foi possível montar as frases agora. Tente novamente em instantes.";
// Auto-avanço: o julgamento fica visível 4s antes da próxima frase abrir
// sozinha (a barrinha animada acompanha a contagem).
const AUTO_ADVANCE_MS = 4000;

// Quando o proxy/deploy devolve HTML (página de erro, build antigo), o
// response.json() lança um erro cru do navegador ("Unexpected token '<'").
// Aqui convertemos isso numa mensagem acionável, com o código HTTP.
async function readJsonOrThrow(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`O servidor respondeu algo inesperado (HTTP ${response.status}). Atualize a página e, se persistir, aguarde alguns minutos — o deploy pode estar em andamento.`);
  }
}

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
  const [senseCreated, setSenseCreated] = useState(false);
  const [result, setResult] = useState<NewWordsSessionResult | null>(null);
  const [resumable, setResumable] = useState<{ sessionId: string; nextSentenceId: string; answeredCount: number; sentenceCount: number } | null>(null);
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
  const prefetchRef = useRef<AudioPrefetchQueue | null>(null);
  // Auto-avanço: 4s após o julgamento a próxima frase abre sozinha; tocar na
  // barrinha adianta. O ref permite cancelar em novo agendamento, reset,
  // abandono e unmount (sem avanço fantasma).
  const autoAdvanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Espera da criação assíncrona: enquanto "preparing", o GET é consultado em
  // ritmo fixo; cancelledRef para o polling no unmount (a tela não tem botão
  // Sair durante a preparação).
  const [preparing, setPreparing] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const inflightJudgeRef = useRef<Promise<unknown> | null>(null);

  const cancelAutoAdvance = useCallback(() => {
    if (autoAdvanceRef.current) { clearTimeout(autoAdvanceRef.current); autoAdvanceRef.current = null; }
  }, []);

  const advanceNow = () => {
    cancelAutoAdvance();
    void continueToNext();
  };

  useEffect(() => cancelAutoAdvance, [cancelAutoAdvance]);
  // O trainer é o dono do próprio shell: cada tela alterna por estado, como o chat.
  // A navegação some só durante a sessão ativa e volta no resultado.
  const shell = (content: React.ReactNode, hideNav: boolean) => (
    <AppShell activeNav="novas" section="novas" noNav={hideNav}>{content}</AppShell>
  );

  useEffect(() => {
    cancelledRef.current = false; // StrictMode (dev) remonta o efeito: reabilita o polling
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    void (async () => {
      try {
        const response = await fetch("/api/practice/new-words", { cache: "no-store" });
        const data = await readJsonOrThrow(response) as { ok?: boolean; activeSession?: ActiveNewWordsPractice | null };
        const active = data.activeSession;
        // O modal é ofertado mesmo com nextSentenceId vazio: sessão com todas
        // as frases respondidas (último "Continuar" não dado, ou complete que
        // falhou) precisa de caminho para o complete/abandono — senão o
        // "Começar" viraria 409 permanente, sem saída pela UI.
        // Sessão "preparing" (app fechado durante a geração) e "failed"
        // recente são ignoradas aqui: o fluxo delas começa no "Começar" (409 → GET).
        if (response.ok && data.ok && active && !active.preparing && !active.failed) {
          setResumable({ sessionId: active.sessionId, nextSentenceId: active.nextSentenceId, answeredCount: active.answeredCount, sentenceCount: active.sentences.length });
          setLanguageCode(active.languageCode ?? "en");
          setLanguageName(active.languageName ?? "idioma estudado");
        }
      } catch { /* overview é best-effort */ }
    })();
    return () => {
      cancelledRef.current = true;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      recognitionRef.current?.abort(); recognitionRef.current = null;
      // O judge em background não é cancelável: só descarta a espera.
      inflightJudgeRef.current?.catch(() => undefined); inflightJudgeRef.current = null;
    };
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
        // Prioriza a frase corrente na fila de prefetch: requestSpeech deduplica
        // por texto+idioma, então autoplay e fila compartilham a MESMA promessa.
        prefetchRef.current?.jumpTo(current.audioText);
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

  // Prefetch do áudio das frases em background: sobe a fila quando a sessão
  // monta, em ritmo seguro para o rate limit de síntese (~27/min). O cleanup
  // cobre unmount, troca de lista e o fim/abandono (result muda as deps).
  useEffect(() => {
    if (!sentences.length || result) return;
    prefetchRef.current?.dispose();
    const queue = createAudioPrefetchQueue({
      texts: sentences.map((sentence) => sentence.audioText),
      request: (text) => requestSpeech(text, languageCode)
    });
    prefetchRef.current = queue;
    queue.start();
    return () => queue.dispose();
  }, [sentences, result, languageCode]);

  async function fetchActiveSession(): Promise<ActiveNewWordsPractice | null> {
    const response = await fetch("/api/practice/new-words", { cache: "no-store" });
    const data = await readJsonOrThrow(response) as { ok?: boolean; activeSession?: ActiveNewWordsPractice | null };
    return response.ok && data.ok ? data.activeSession ?? null : null;
  }

  function enterPreparation(targetSessionId: string) {
    setPreparing(true); setResumable(null); setResult(null);
    pollTimerRef.current = setTimeout(() => { pollTimerRef.current = null; void pollForDeck(targetSessionId, 1); }, POLL_INTERVAL_MS);
  }

  async function pollForDeck(targetSessionId: string, attempt: number): Promise<void> {
    if (cancelledRef.current) return;
    const giveUp = () => { setPreparing(false); setError(PREPARING_ERROR); };
    const scheduleNext = () => {
      pollTimerRef.current = setTimeout(() => { pollTimerRef.current = null; void pollForDeck(targetSessionId, attempt + 1); }, POLL_INTERVAL_MS);
    };
    try {
      const active = await fetchActiveSession();
      if (cancelledRef.current) return;
      if (active && active.sessionId === targetSessionId) {
        if ("failed" in active && active.failed) { giveUp(); return; }
        // Pronto: segue exatamente como o fluxo antigo (o burst de prefetch
        // sobe no effect existente ao setSentences).
        if (!active.preparing && active.sentences.length) { applyDeck(active); return; }
      }
      if (attempt >= MAX_POLL_ATTEMPTS) { giveUp(); return; }
      scheduleNext();
    } catch {
      // Erro transitório de rede/HTML durante a espera: continua tentando até esgotar.
      if (cancelledRef.current) return;
      if (attempt >= MAX_POLL_ATTEMPTS) { giveUp(); return; }
      scheduleNext();
    }
  }

  function applyDeck(active: ReadyNewWordsSession) {
    const next = active.sentences.find((sentence) => sentence.id === active.nextSentenceId) ?? active.sentences[0];
    setSessionId(active.sessionId); setCompletionId(crypto.randomUUID());
    setSentences(active.sentences); setWords(active.words ?? []);
    setAnsweredIds(new Set(active.answeredSentenceIds));
    setCurrent(next);
    setLanguageCode(active.languageCode ?? "en"); setLanguageName(active.languageName ?? "idioma estudado");
    setResumable(null); setResult(null); setPreparing(false); resetAttempt();
  }

  async function start() {
    setBusy(true); setError("");
    // Destrava o áudio ainda no gesto do clique (iOS): todo autoplay seguinte
    // acontece no mesmo elemento já destravado. O polling de preparação não
    // depende de gesto — o elemento permanece destravado para os plays futuros.
    const audio = audioRef.current ?? new Audio();
    audioRef.current = audio;
    unlockAudioForPlayback(audio);
    try {
      const response = await fetch("/api/practice/new-words", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ count: size }) });
      const data = await readJsonOrThrow(response) as { ok?: boolean; error?: string; sessionId?: string; status?: string };
      if (!response.ok) {
        // 409 = já existe sessão em andamento (ex.: app fechado durante a
        // preparação). Consulta o GET: se estiver "preparing", entra na espera
        // em vez de mostrar erro.
        if (response.status === 409 || /em andamento/i.test(data.error ?? "")) {
          const snapshot = await fetchActiveSession();
          if (snapshot?.preparing) {
            enterPreparation(snapshot.sessionId);
            return;
          }
        }
        throw new Error(data.error ?? "Não foi possível montar a sessão.");
      }
      if (!data.ok || !data.sessionId || data.status !== "preparing") throw new Error(data.error ?? "Não foi possível montar a sessão.");
      enterPreparation(data.sessionId);
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
      const data = await readJsonOrThrow(response) as { ok?: boolean; activeSession?: { sessionId: string; sentences: NewWordsSentence[]; words: NewWordPreview[]; answeredSentenceIds: string[]; nextSentenceId: string; languageCode: string; languageName: string } | null };
      const active = data.activeSession;
      if (!response.ok || !data.ok || !active) throw new Error("Não foi possível retomar a sessão.");
      setLanguageCode(active.languageCode ?? "en"); setLanguageName(active.languageName ?? "idioma estudado");
      const next = active.sentences.find((sentence) => sentence.id === active.nextSentenceId);
      if (next) {
        setSessionId(active.sessionId); setCompletionId(crypto.randomUUID());
        setSentences(active.sentences); setWords(active.words ?? []);
        setAnsweredIds(new Set(active.answeredSentenceIds));
        setCurrent(next);
        setResumable(null); setResult(null); resetAttempt();
        return;
      }
      // nextSentenceId vazio (ou ausente das frases): tudo já foi julgado e a
      // sessão só precisa do complete para mostrar o resultado. Se falhar, o
      // erro fica inline e o modal continua com Continuar/Abandonar.
      const completeResponse = await fetch("/api/practice/new-words/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: active.sessionId, clientCompletionId: crypto.randomUUID() }) });
      const completeData = await readJsonOrThrow(completeResponse) as { ok?: boolean; error?: string } & Partial<NewWordsSessionResult>;
      if (!completeResponse.ok || !completeData.ok || typeof completeData.score !== "number") throw new Error(completeData.error ?? "Não foi possível concluir a sessão.");
      prefetchRef.current?.dispose();
      setResult(completeData as NewWordsSessionResult); setCurrent(null); setResumable(null);
    } catch (resumeError) { setError(resumeError instanceof Error ? resumeError.message : "Não foi possível retomar."); }
    finally { setBusy(false); }
  }

  async function submitTranslation(event?: FormEvent) {
    event?.preventDefault();
    // Som de confirmação no gesto: o AudioContext só destrava dentro do gesto
    // do usuário, então toca aqui (antes de qualquer await) e só no Traduzir.
    playButtonSound();
    if (!current || judgment || busy || !input.trim()) return;
    recognitionRef.current?.stop();
    const translation = input.trim();
    const clientAttemptId = crypto.randomUUID();
    const judgeBody = JSON.stringify({
      sessionId, clientAttemptId, sentenceId: current.id, userTranslation: translation,
      responseTimeMs: Math.max(0, Date.now() - startedAt), usedSpeech, audioReplayCount, audioFailed
    });
    // Match exato detectado no cliente (mesma regra do servidor): reveal
    // imediato, sem esperar o servidor. O POST do judge segue em background —
    // o registro persistido continua sendo o do servidor — e o continueToNext
    // espera essa promise antes de avançar/complete. Sem busy: nada a esperar.
    if (compareFlashcardAnswer(translation, current.translation) === "exact") {
      setJudgment({ verdict: "correct", feedback: "", correctedTranslation: current.translation });
      setAnsweredIds((previous) => new Set([...previous, current.id]));
      cancelAutoAdvance();
      autoAdvanceRef.current = setTimeout(() => { autoAdvanceRef.current = null; void continueToNext(); }, AUTO_ADVANCE_MS);
      const backgroundJudge = fetch("/api/practice/new-words/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: judgeBody })
        .then(async (response) => {
          const data = await readJsonOrThrow(response) as { ok?: boolean; error?: string; attempt?: { judgment: JudgedTranslation; senseCreated: boolean } };
          if (!response.ok || !data.ok || !data.attempt) throw new Error(data.error ?? "Não foi possível avaliar a tradução.");
          return data;
        });
      inflightJudgeRef.current = backgroundJudge;
      // Falha do judge em background = tentativa NÃO persistida: volta para o
      // FORMULÁRIO da mesma frase (o texto digitado segue em `input`) para o
      // reenvio criar um judge novo e persistir. O timer é cancelado — não pode
      // avançar uma frase sem registro. Ignorado se abandon/unmount já
      // descartaram esta promise. O ref guarda a promise bruta (que rejeita):
      // o continueToNext suspenso no await precisa ver a falha para NÃO avançar.
      backgroundJudge.catch((judgeError) => {
        if (inflightJudgeRef.current !== backgroundJudge) return;
        inflightJudgeRef.current = null;
        cancelAutoAdvance();
        setJudgment(null);
        setError(judgeError instanceof Error ? judgeError.message : "Não foi possível avaliar a tradução.");
      });
      return;
    }
    // Demais traduções: aguarda o julgamento da IA (busy/spinner).
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/new-words/judge", { method: "POST", headers: { "Content-Type": "application/json" }, body: judgeBody });
      const data = await readJsonOrThrow(response) as { ok?: boolean; error?: string; attempt?: { judgment: JudgedTranslation; senseCreated: boolean } };
      if (!response.ok || !data.ok || !data.attempt) throw new Error(data.error ?? "Não foi possível avaliar a tradução.");
      setJudgment(data.attempt.judgment); setSenseCreated(Boolean(data.attempt.senseCreated));
      setAnsweredIds((previous) => new Set([...previous, current.id]));
      // O julgamento fica visível 4s (a barrinha dá o feedback visual do tempo)
      // e a próxima frase abre sozinha; tocar na barrinha adianta.
      cancelAutoAdvance();
      autoAdvanceRef.current = setTimeout(() => { autoAdvanceRef.current = null; void continueToNext(); }, AUTO_ADVANCE_MS);
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : "Não foi possível avaliar a tradução."); }
    finally { setBusy(false); }
  }

  async function continueToNext() {
    // Judge em background (reveal otimista): espera a tentativa ser persistida
    // ANTES de avançar/complete — sem isso o complete pode rodar com frases
    // pendentes e o avanço pode pedir frase já julgada (409). Se o judge
    // falhou, mostra o mesmo erro inline e não avança.
    if (inflightJudgeRef.current) {
      try { await inflightJudgeRef.current; }
      catch (judgeError) {
        inflightJudgeRef.current = null;
        setError(judgeError instanceof Error ? judgeError.message : "Não foi possível avaliar a tradução.");
        return;
      }
      inflightJudgeRef.current = null;
    }
    // Guardas: busy (sem botão Continuar, a barrinha e o timer precisam dela
    // para não disparar dois avanços/complete em paralelo) e judgment (nunca
    // avançar sem julgamento visível — cinto e suspensório contra stale
    // closure; o cancel do timer na falha do judge em background é a proteção
    // real, pois o `judgment` aqui pode ser o valor da renderização antiga).
    if (!current || busy || !judgment) return;
    const index = sentences.findIndex((sentence) => sentence.id === current.id);
    const next = sentences[index + 1];
    if (next) { setCurrent(next); resetAttempt(); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/new-words/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, clientCompletionId: completionId }) });
      const data = await readJsonOrThrow(response) as { ok?: boolean; error?: string } & Partial<NewWordsSessionResult>;
      if (!response.ok || !data.ok || typeof data.score !== "number") throw new Error(data.error ?? "Não foi possível concluir a sessão.");
      prefetchRef.current?.dispose();
      setResult(data as NewWordsSessionResult); setCurrent(null); setResumable(null);
    } catch (finishError) { setError(finishError instanceof Error ? finishError.message : "Não foi possível concluir a sessão."); }
    finally { setBusy(false); }
  }

  async function abandonSession() {
    // Cancela ANTES do fetch: com "Sair" no meio da contagem de 4s, um timer
    // armado poderia disparar POST /complete concorrente ao abandon.
    cancelAutoAdvance();
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/new-words/abandon", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId }) });
      if (!response.ok) throw new Error("Não foi possível abandonar a sessão.");
      // O judge em background (reveal otimista) deixou de ser esperado: a sessão
      // foi abandonada — apenas evita rejeição não tratada (o fetch não é cancelável).
      inflightJudgeRef.current?.catch(() => undefined); inflightJudgeRef.current = null;
      prefetchRef.current?.dispose();
      setSessionId(""); setSentences([]); setCurrent(null); setJudgment(null); setResumable(null); resetAttempt();
    } catch (abandonError) { setError(abandonError instanceof Error ? abandonError.message : "Não foi possível abandonar."); }
    finally { setBusy(false); }
  }

  function resetAttempt() {
    cancelAutoAdvance();
    setInput(""); setJudgment(null); setSenseCreated(false); setAudioFailed(false); setUsedSpeech(false); setAudioReplayCount(0);
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

  if (result) return shell(<div className="flashcard-screen">
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
  </div>, false);

  if (current) {
    const wordIndex = words.findIndex((word) => word.wordId === current.targetWordId);
    return shell(<div className="flashcard-screen">
      <audio ref={audioRef} className="sr-only" preload="auto" />
      <div className="top-row">
        <button className="back-link button-reset" onClick={() => void abandonSession()} disabled={busy} type="button"><ArrowLeft /> Sair</button>
        <Pill>{answeredIds.size}/{sentences.length} frases{wordIndex >= 0 ? ` · palavra ${wordIndex + 1}/${words.length}` : ""}</Pill>
      </div>
      <div className="progress-line"><span style={{ width: `${(answeredIds.size / Math.max(1, sentences.length)) * 100}%` }} /></div>
      <section className="active-recall-card" aria-label="Frase para traduzir">
        <span>Traduza para o português</span>
        <strong>
          {(() => {
            const word = words.find((candidate) => candidate.wordId === current.targetWordId);
            const parts = word ? splitSentenceAroundTarget(current.sentence, word.lemma) : null;
            if (!parts) return current.sentence;
            return <>{parts.before}<mark className="sentence-target-word">{parts.match}</mark>{parts.after}</>;
          })()}
        </strong>
        <p className="sentence-target-translation">
          {(() => {
            const word = words.find((candidate) => candidate.wordId === current.targetWordId);
            return word ? `${word.lemma} · ${word.translation}` : "";
          })()}
        </p>
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
        {judgment.newSenseTranslation ? <p className="speech-status">{senseCreated ? `Registrado: “${judgment.newSenseTranslation}” entrou como novo significado desta palavra.` : "Esse significado já estava registrado."}</p> : null}
        <button aria-label="Avançar para a próxima frase" className="auto-advance" onClick={advanceNow} type="button">
          <span className="auto-advance-bar" />
        </button>
      </section>}
      {busy ? <p className="speech-status"><Loader2 className="spin" /> Salvando...</p> : null}
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </div>, true);
  }

  return shell(<div className="flashcard-screen">
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
      <p className="row-meta">{resumable.answeredCount >= resumable.sentenceCount ? "Todas as frases já foram traduzidas. Toque em continuar para ver o resultado." : `Você já traduziu ${resumable.answeredCount} ${resumable.answeredCount === 1 ? "frase" : "frases"} desta sessão.`}</p>
      <div className="flashcard-resume-actions">
        <button className="green-button" disabled={busy} onClick={() => void resume()} type="button">Continuar sessão</button>
        <button className="danger-button" disabled={busy} onClick={() => { setResumable(null); void abandonResumable(resumable.sessionId); }} type="button">Abandonar</button>
      </div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section></div> : null}
    <section className="section">
      <h2 className="section-title">Quantas palavras quer aprender?</h2>
      <div className="flashcard-choice-grid">
        {newWordsSessionSizes.map((option) => (
          <button key={option} className={size === option ? "choice-card active" : "choice-card"} disabled={busy || preparing} onClick={() => setSize(option)} type="button">
            <div><strong>{option}</strong><span>palavras · {option * SENTENCES_PER_WORD} frases</span></div>
          </button>
        ))}
      </div>
      <button className="green-button full-button" disabled={busy || preparing} onClick={() => void start()} type="button">
        {busy || preparing ? <><Loader2 className="spin" /> Preparando suas frases...</> : <><Sparkles /> Começar com {size} palavra{size === 1 ? "" : "s"}</>}
      </button>
      <p className="row-meta">Cada palavra vem em {SENTENCES_PER_WORD} frases curtas. Ouça, traduza e a IA corrige na hora.</p>
    </section>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>, false);

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
