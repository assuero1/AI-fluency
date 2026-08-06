"use client";

import { ArrowLeft, Brain, Check, Clock3, Layers3, Loader2, Mic, MicOff, RotateCcw, Sparkles, Trophy, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { compareAnswerForCard } from "@/lib/learning/flashcard-answer";
import { advanceFlashcardQueue, createFlashcardQueue, selectNextQueueItem, inferRecallRating, rebuildFlashcardQueue } from "@/lib/learning/flashcard-queue";
import type { AnswerMatch, DailyQueueSummary, Flashcard, FlashcardAnswer, FlashcardCriterion, FlashcardPracticeResult, FlashcardQueueKind, QueueItem, RecallRating } from "@/lib/learning/flashcard-contracts";
import { Pill } from "./Pill";
import { VoiceButton } from "./VoiceButton";

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
type RecognitionConstructor = new () => Recognition;

export function FlashcardTrainer() {
  const [criterion, setCriterion] = useState<FlashcardCriterion>("least_used");
  const [count, setCount] = useState(10);
  const [sessionId, setSessionId] = useState("");
  const [completionId, setCompletionId] = useState("");
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [languageCode, setLanguageCode] = useState("es");
  const [languageName, setLanguageName] = useState("idioma estudado");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentItem, setCurrentItem] = useState<QueueItem | null>(null);
  const [input, setInput] = useState("");
  const [revealed, setRevealed] = useState<{ match: AnswerMatch; forgot: boolean; responseTimeMs: number; inferredRating: RecallRating; forgotDays: number | null; rememberedDays: number | null } | null>(null);
  const [undoState, setUndoState] = useState<{ expiresAt: number } | null>(null);
  const [presentationStartedAt, setPresentationStartedAt] = useState(0);
  const [adapted, setAdapted] = useState(false);
  const [currentAttemptId, setCurrentAttemptId] = useState("");
  const [resumable, setResumable] = useState<null | { sessionId: string; cards: Flashcard[]; attempts: FlashcardAnswer[]; queue: QueueItem[]; currentItem: QueueItem | null; languageCode: string; languageName: string; adapted: boolean }>(null);
  const [usedSpeech, setUsedSpeech] = useState(false);
  const [audioReplayCount, setAudioReplayCount] = useState(0);
  const [usedSlowAudio, setUsedSlowAudio] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [answers, setAnswers] = useState<FlashcardAnswer[]>([]);
  const [result, setResult] = useState<FlashcardPracticeResult | null>(null);
  const [exitConfirmationOpen, setExitConfirmationOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dailyQueue, setDailyQueue] = useState<DailyQueueSummary | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [quotaSaving, setQuotaSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<Recognition | null>(null);

  useEffect(() => {
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    setSpeechSupported(Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition));
    return () => recognitionRef.current?.abort();
  }, []);

  async function loadOverview() {
    try {
      const response = await fetch("/api/practice/flashcards", { cache: "no-store" });
      const data = await response.json() as { ok?: boolean; activeSession?: typeof resumable; dailyQueue?: DailyQueueSummary | null };
      if (response.ok && data.ok) {
        if (data.activeSession) setResumable(data.activeSession);
        setDailyQueue(data.dailyQueue ?? null);
      }
    } catch { /* overview é best-effort; a sessão custom continua disponível */ }
  }

  useEffect(() => {
    void loadOverview();
  }, []);

  useEffect(() => {
    if (cards.length && !revealed) inputRef.current?.focus();
  }, [cards.length, currentItem, revealed]);

  useEffect(() => {
    if (!undoState) return;
    const timeout = setTimeout(() => setUndoState(null), Math.max(0, undoState.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [undoState]);

  async function start(queueKind: FlashcardQueueKind) {
    setBusy(true); setError("");
    try {
      const body = queueKind === "custom" ? { queueKind, criterion, count } : { queueKind };
      const response = await fetch("/api/practice/flashcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { ok?: boolean; error?: string; sessionId?: string; cards?: Flashcard[]; languageCode?: string; languageName?: string; adapted?: boolean };
      if (!response.ok || !data.ok || !data.sessionId || !data.cards?.length) throw new Error(data.error ?? "Não foi possível montar o treino.");
      const initialQueue = createFlashcardQueue(data.cards);
      setSessionId(data.sessionId); setCompletionId(crypto.randomUUID()); setCards(data.cards); setQueue(initialQueue); setCurrentItem(selectNextQueueItem(initialQueue, 0)); setLanguageCode(data.languageCode ?? "es"); setLanguageName(data.languageName ?? "idioma estudado"); setAdapted(data.adapted === true); setResumable(null); setAnswers([]); setResult(null); resetAttempt();
    } catch (startError) { setError(startError instanceof Error ? startError.message : "Não foi possível montar o treino."); }
    finally { setBusy(false); }
  }

  async function changeQuota(delta: number) {
    if (!dailyQueue || quotaSaving) return;
    const next = Math.max(0, Math.min(50, dailyQueue.quota + delta));
    if (next === dailyQueue.quota) return;
    setQuotaSaving(true);
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dailyNewCardsQuota: next }) });
      if (response.ok) await loadOverview();
    } catch { /* mantém a quota anterior na tela */ }
    finally { setQuotaSaving(false); }
  }

  async function submitAttempt(event?: FormEvent, forgot = false) {
    event?.preventDefault();
    if (revealed || busy || (!forgot && !input.trim())) return;
    recognitionRef.current?.stop();
    const card = cards.find((candidate) => candidate.id === currentItem?.cardId);
    if (!card || !currentItem) return;
    const match = forgot ? "incorrect" as const : compareAnswerForCard(card, input);
    const responseTimeMs = Math.max(0, Date.now() - presentationStartedAt);
    setListening(false);
    const fallback = { inferredRating: inferRecallRating({ match, forgot, responseTimeMs, cardType: card.type }), forgotDays: null, rememberedDays: null };
    try {
      const response = await fetch("/api/practice/flashcards/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, cardId: currentItem.cardId, presentationNumber: currentItem.presentationNumber, userAnswer: input.trim(), forgot, responseTimeMs }) });
      const data = await response.json() as { ok?: boolean; inferredRating?: RecallRating; forgotDays?: number; rememberedDays?: number };
      if (!response.ok || !data.ok || typeof data.forgotDays !== "number" || typeof data.rememberedDays !== "number") throw new Error("preview unavailable");
      setRevealed({ match, forgot, responseTimeMs, inferredRating: data.inferredRating ?? fallback.inferredRating, forgotDays: data.forgotDays, rememberedDays: data.rememberedDays });
    } catch {
      setRevealed({ match, forgot, responseTimeMs, ...fallback });
    }
  }

  async function grade(remembered: boolean) {
    if (!revealed || busy || !currentItem) return;
    setBusy(true); setError("");
    const clientAttemptId = currentAttemptId || crypto.randomUUID();
    setCurrentAttemptId(clientAttemptId);
    let persisted: FlashcardAnswer;
    try {
      const attemptResponse = await fetch("/api/practice/flashcards/attempt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, clientAttemptId, cardId: currentItem.cardId, presentationNumber: currentItem.presentationNumber, userAnswer: input.trim(), remembered, forgot: revealed.forgot, usedSpeech, responseTimeMs: revealed.responseTimeMs, audioReplayCount, usedSlowAudio, audioFailed }) });
      const attemptData = await attemptResponse.json() as { ok?: boolean; error?: string; attempt?: FlashcardAnswer };
      if (!attemptResponse.ok || !attemptData.ok || !attemptData.attempt) throw new Error(attemptData.error ?? "Não foi possível salvar a tentativa.");
      persisted = attemptData.attempt;
      setUndoState({ expiresAt: Date.now() + 5_000 });
    } catch (attemptError) {
      setError(attemptError instanceof Error ? attemptError.message : "Não foi possível salvar a tentativa."); setBusy(false); return;
    }
    const nextAnswers = [...answers, persisted];
    const nextQueue = advanceFlashcardQueue(queue, currentItem, persisted.rating, nextAnswers.length);
    const nextItem = selectNextQueueItem(nextQueue, nextAnswers.length);
    if (nextItem) {
      setAnswers(nextAnswers); setQueue(nextQueue); setCurrentItem(nextItem); setBusy(false); resetAttempt(); return;
    }
    try {
      const response = await fetch("/api/practice/flashcards/complete", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, clientCompletionId: completionId, answers: nextAnswers }) });
      const data = await response.json() as ({ ok?: boolean; error?: string } & Partial<FlashcardPracticeResult>);
      if (!response.ok || !data.ok || typeof data.score !== "number") throw new Error(data.error ?? "Não foi possível concluir o treino.");
      setAnswers(nextAnswers); setResult(data as FlashcardPracticeResult); setResumable(null);
    } catch (finishError) { setError(finishError instanceof Error ? finishError.message : "Não foi possível concluir o treino."); }
    finally { setBusy(false); }
  }

  async function undoLast() {
    if (!undoState || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/practice/flashcards/${sessionId}/undo`, { method: "POST" });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível desfazer.");
      const remainingAnswers = answers.slice(0, -1);
      const rebuilt = rebuildFlashcardQueue(cards, remainingAnswers);
      setAnswers(remainingAnswers); setQueue(rebuilt.queue); setCurrentItem(rebuilt.currentItem); setUndoState(null); resetAttempt();
    } catch (undoError) { setError(undoError instanceof Error ? undoError.message : "Não foi possível desfazer."); }
    finally { setBusy(false); }
  }

  function resetAttempt() {
    recognitionRef.current?.abort(); recognitionRef.current = null;
    setInput(""); setRevealed(null); setUsedSpeech(false); setListening(false); setAudioReplayCount(0); setUsedSlowAudio(false); setAudioFailed(false); setError(""); setCurrentAttemptId(""); setPresentationStartedAt(Date.now());
  }

  function continueSession() {
    if (!resumable?.currentItem) return;
    setSessionId(resumable.sessionId); setCompletionId(crypto.randomUUID()); setCards(resumable.cards); setAnswers(resumable.attempts); setQueue(resumable.queue); setCurrentItem(resumable.currentItem); setLanguageCode(resumable.languageCode); setLanguageName(resumable.languageName); setAdapted(resumable.adapted); setResult(null); resetAttempt();
  }

  async function abandonSession(targetSessionId: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/practice/flashcards/${targetSessionId}/abandon`, { method: "POST" });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível abandonar o treino.");
      setCards([]); setQueue([]); setCurrentItem(null); setAnswers([]); setSessionId(""); setResumable(null); setExitConfirmationOpen(false); resetAttempt();
    } catch (abandonError) { setError(abandonError instanceof Error ? abandonError.message : "Não foi possível abandonar o treino."); }
    finally { setBusy(false); }
  }

  async function restartSession() {
    if (!resumable) return;
    await abandonSession(resumable.sessionId);
    await start("daily");
  }

  async function startRetraining(mode: "wrong" | "difficult") {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/practice/flashcards/retrain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceSessionId: sessionId, mode }) });
      const data = await response.json() as { ok?: boolean; error?: string; sessionId?: string; cards?: Flashcard[]; languageCode?: string; languageName?: string; adapted?: boolean };
      if (!response.ok || !data.ok || !data.sessionId || !data.cards?.length) throw new Error(data.error ?? "Não foi possível iniciar o retreino.");
      const initialQueue = createFlashcardQueue(data.cards);
      setSessionId(data.sessionId); setCompletionId(crypto.randomUUID()); setCards(data.cards); setQueue(initialQueue); setCurrentItem(selectNextQueueItem(initialQueue, 0)); setLanguageCode(data.languageCode ?? languageCode); setLanguageName(data.languageName ?? languageName); setAdapted(data.adapted === true); setAnswers([]); setResult(null); resetAttempt();
    } catch (retrainError) { setError(retrainError instanceof Error ? retrainError.message : "Não foi possível iniciar o retreino."); }
    finally { setBusy(false); }
  }

  function toggleSpeech() {
    if (listening) { recognitionRef.current?.stop(); return; }
    const speechWindow = window as typeof window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
    const Constructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!Constructor) return;
    const recognition = new Constructor(); recognitionRef.current = recognition;
    const currentCard = cards.find((card) => card.id === currentItem?.cardId);
    recognition.lang = currentCard?.type === "target_to_native" ? "pt-BR" : languageCode; recognition.interimResults = true; recognition.continuous = false;
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = 0; i < event.results.length; i += 1) transcript += event.results[i][0]?.transcript ?? "";
      setInput(transcript.trim()); setUsedSpeech(true);
    };
    recognition.onerror = () => { setListening(false); setError("Não foi possível transcrever. Digite ou tente novamente."); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; inputRef.current?.focus(); };
    setError(""); setListening(true); recognition.start();
  }

  if (result) return <div className="flashcard-screen">
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-result">
      <div className="flashcard-trophy"><Trophy /></div><div className="eyebrow">Treino concluído</div><h1 className="title">{result.score}% de acerto</h1>
      <p className="subtitle">Cada tentativa ajustou o domínio e a próxima revisão das palavras.</p>
      <div className="flashcard-result-grid"><div><strong>{result.uniqueCardCount}</strong><span>cards únicos</span></div><div><strong>{result.presentationCount}</strong><span>apresentações</span></div><div><strong>{result.recoveredCards}</strong><span>recuperados</span></div></div>
      <section className="flashcard-result-details" aria-label="Detalhes do resultado">
        <div><span>Primeira tentativa</span><strong>{formatAccuracy(result.firstAttemptAccuracy)}</strong></div><div><span>Recuperação final</span><strong>{formatAccuracy(result.eventualRecallAccuracy)}</strong></div><div><span>Compreensão</span><strong>{formatAccuracy(result.comprehensionAccuracy)}</strong></div><div><span>Produção</span><strong>{formatAccuracy(result.productionAccuracy)}</strong></div><div><span>Escuta</span><strong>{formatAccuracy(result.listeningAccuracy)}</strong></div><div><span>Tempo médio</span><strong>{formatResponseTime(result.averageResponseTimeMs)}</strong></div><div><span>Duração</span><strong>{formatDuration(result.durationSeconds)}</strong></div><div><span>Palavras difíceis</span><strong>{typeof result.difficultWords === "number" ? result.difficultWords : "—"}</strong></div>
      </section>
      <div className="progress-line"><span style={{ width: `${result.score}%` }} /></div>
      <section className="flashcard-retrain" aria-label="Retreinos">
        <strong>Praticar novamente</strong>
        <div><button className="outline-button" disabled={busy} onClick={() => void startRetraining("wrong")} type="button">Somente erradas</button><button className="outline-button" disabled={busy} onClick={() => void startRetraining("difficult")} type="button">Somente difíceis</button></div>
        <Link className="outline-button" href={`/chat?flashcardSession=${encodeURIComponent(sessionId)}`}>Usar palavras em conversa</Link>
      </section>
      <button className="green-button full-button" onClick={() => { setCards([]); setResult(null); void loadOverview(); }} type="button"><RotateCcw /> Novo treino</button>
      <Link className="outline-button full-button" href="/palavras">Voltar às palavras</Link>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
    </section>
  </div>;

  if (cards.length && currentItem) {
    const card = cards.find((candidate) => candidate.id === currentItem.cardId);
    if (!card) return null;
    const uniqueCompleted = new Set(answers.filter((answer) => answer.presentationNumber === 1).map((answer) => answer.cardId)).size;
    return <div className="flashcard-screen">
      <div className="top-row"><button className="back-link button-reset" onClick={() => setExitConfirmationOpen(true)} type="button"><ArrowLeft /> Sair</button><Pill>{uniqueCompleted}/{cards.length} cards · apresentação {answers.length + 1}</Pill></div>
      <div className="progress-line"><span style={{ width: `${((uniqueCompleted + (currentItem.presentationNumber === 1 && revealed ? 1 : 0)) / cards.length) * 100}%` }} /></div>
      {adapted ? <p className="flashcard-adapted">O treino foi adaptado porque algumas frases contextuais não passaram na validação.</p> : null}
      <div className="flashcard-kind"><Pill tone={card.type === "cloze" ? "info" : "primary"}>{cardTypeLabel(card.type)}</Pill></div>
      <section className="active-recall-card" aria-label={card.type === "listening" ? "Card de escuta" : "Card de recuperação ativa"}>
        <span>{card.type === "listening" ? "Ouça antes de responder" : card.type === "cloze" ? "Complete a frase" : "Lembre antes de responder"}</span>
        {card.type === "listening" ? <div className="flashcard-listening-controls">
          <VoiceButton languageCode={languageCode} label="Ouvir áudio" onAudioFailure={() => setAudioFailed(true)} onPlayback={(event) => { setAudioReplayCount((count) => count + 1); if (event.slow) setUsedSlowAudio(true); }} text={card.audioText ?? card.sentence ?? card.expectedAnswer} />
          <VoiceButton compact languageCode={languageCode} label="Ouvir lentamente" onAudioFailure={() => setAudioFailed(true)} onPlayback={() => { setAudioReplayCount((count) => count + 1); setUsedSlowAudio(true); }} playbackRate={0.75} text={card.audioText ?? card.sentence ?? card.expectedAnswer} />
          {audioFailed ? <p className="flashcard-audio-fallback" role="status">Áudio indisponível. Continue pelo texto: <strong>{card.audioText ?? card.expectedAnswer}</strong></p> : null}
        </div> : <>
          <strong>{card.prompt}</strong>
          {card.type !== "native_to_target" ? <VoiceButton compact languageCode={languageCode} label="Ouvir palavra" onAudioFailure={() => setAudioFailed(true)} onPlayback={(event) => { setAudioReplayCount((count) => count + 1); if (event.slow) setUsedSlowAudio(true); }} text={card.audioText ?? card.sentence ?? card.prompt} /> : null}
        </>}
      </section>
      {!revealed ? <form className="flashcard-attempt" onSubmit={submitAttempt}>
        <label htmlFor="flashcard-answer">Resposta esperada em {card.type === "target_to_native" || card.type === "listening" ? "português" : languageName}</label>
        <div className="flashcard-input-row"><input autoComplete="off" id="flashcard-answer" maxLength={300} onChange={(event) => setInput(event.target.value)} placeholder="Digite sua resposta" ref={inputRef} value={input} /><button aria-label={listening ? "Parar transcrição" : "Falar resposta"} className={listening ? "voice-icon-button listening" : "voice-icon-button"} disabled={!speechSupported} onClick={toggleSpeech} type="button">{listening ? <MicOff /> : <Mic />}</button></div>
        {usedSpeech ? <p className="speech-status">Transcrição pronta para revisar e editar.</p> : null}
        <div className="flashcard-attempt-actions"><button className="outline-button" onClick={(event) => void submitAttempt(event, true)} type="button">Não lembro</button><button className="green-button" disabled={!input.trim()} type="submit">Responder</button></div>
      </form> : <section className="flashcard-reveal" aria-live="polite">
        <div><span>Resposta esperada</span><strong>{card.expectedAnswer}</strong></div>
        <div><span>Sua tentativa</span><strong>{revealed.forgot ? "Não lembrei" : input}</strong></div>
        <p className={`answer-match ${revealed.match}`}>{matchLabel(revealed.match)}</p>
        <p>{ratingExplanation(revealed)}</p>
        <div className="recall-rating-grid">
          <button disabled={busy} onClick={() => void grade(false)} type="button"><X /> Não lembrei{revealed.forgotDays ? <span className="interval-hint">→ {formatIntervalDays(revealed.forgotDays)}</span> : null}</button>
          <button className="suggested" disabled={busy} onClick={() => void grade(true)} type="button"><Check /> Lembrei{revealed.rememberedDays ? <span className="interval-hint">→ {formatIntervalDays(revealed.rememberedDays)}</span> : null}</button>
        </div>
      </section>}
      {undoState ? <p className="speech-status">Avaliação registrada. <button className="outline-button" disabled={busy} onClick={() => void undoLast()} type="button">Desfazer</button></p> : null}
      {busy ? <p className="speech-status"><Loader2 className="spin" /> Salvando resultado...</p> : null}{error ? <p className="inline-error" role="alert">{error}</p> : null}
      {exitConfirmationOpen ? <div className="modal-backdrop" role="presentation"><section aria-labelledby="leave-training-title" aria-modal="true" className="confirmation-modal" role="dialog"><h2 className="section-title" id="leave-training-title">Sair do treino?</h2><p className="row-meta">Você poderá continuar depois. Se abandonar, as tentativas já salvas ficam auditáveis, mas nenhuma palavra pendente terá o domínio alterado.</p><div className="modal-actions"><button className="outline-button" disabled={busy} onClick={() => setExitConfirmationOpen(false)} type="button">Continuar treinando</button><button className="danger-button" disabled={busy} onClick={() => void abandonSession(sessionId)} type="button">Abandonar treino</button></div></section></div> : null}
    </div>;
  }

  return <div className="flashcard-screen">
    <Link className="back-link" href="/palavras"><ArrowLeft /> Palavras</Link>
    <section className="flashcard-intro"><div className="flashcard-brand"><Brain /></div><div><div className="eyebrow">Revisão inteligente</div><h1 className="title">Treino de cards</h1><p className="subtitle">Recupere a palavra da memória antes de conferir a resposta.</p></div></section>
    {resumable?.currentItem ? <div className="modal-backdrop" role="presentation"><section aria-labelledby="resume-training-title" aria-modal="true" className="confirmation-modal" role="dialog"><RotateCcw /><h2 className="section-title" id="resume-training-title">Treino em andamento</h2><p className="row-meta">Você já concluiu {resumable.attempts.length} apresentações. Escolha como seguir.</p><div className="flashcard-resume-actions"><button className="green-button" disabled={busy} onClick={continueSession} type="button">Continuar treino</button><button className="outline-button" disabled={busy} onClick={() => void restartSession()} type="button">Reiniciar treino</button><button className="danger-button" disabled={busy} onClick={() => void abandonSession(resumable.sessionId)} type="button">Abandonar</button></div></section></div> : null}
    {dailyQueue ? <section className="section flashcard-daily" aria-label="Fila de hoje">
      <h2 className="section-title">Fila de hoje</h2>
      {dailyQueue.sessionCardCount > 0 ? <>
        <p className="row-meta">{dailyQueue.dueCount} revisões + {dailyQueue.newCount} novas · ~{dailyQueue.estimatedMinutes} min{dailyQueue.remainingCount > 0 ? ` · +${dailyQueue.remainingCount} continuam depois` : ""}</p>
        <button className="green-button full-button" disabled={busy} onClick={() => void start("daily")} type="button">{busy ? <Loader2 className="spin" /> : <Brain />} Começar revisão de hoje</button>
      </> : <p className="row-meta">{dailyQueue.introducedToday > 0 ? "Fila de hoje concluída. Amanhã há mais — ou pratique abaixo." : "Nada na fila de hoje. Converse para salvar palavras novas ou monte uma sessão custom."}</p>}
      <div className="top-row row-meta">
        <span>Novas por dia</span>
        <span>
          <button aria-label="Diminuir novas por dia" className="outline-button" disabled={quotaSaving || dailyQueue.quota <= 0} onClick={() => void changeQuota(-1)} type="button">−</button>
          <strong> {dailyQueue.quota} </strong>
          <button aria-label="Aumentar novas por dia" className="outline-button" disabled={quotaSaving || dailyQueue.quota >= 50} onClick={() => void changeQuota(1)} type="button">+</button>
        </span>
      </div>
    </section> : null}
    {dailyQueue && dailyQueue.difficultCount > 0 ? <button className="outline-button full-button" disabled={busy} onClick={() => void start("difficult")} type="button">Só difíceis ({dailyQueue.difficultCount})</button> : null}
    <button className="outline-button full-button" onClick={() => setCustomOpen((open) => !open)} type="button">Sessão custom</button>
    {customOpen ? <>
      <section className="section"><h2 className="section-title">Quais palavras priorizar?</h2><p className="row-meta">Palavras com revisão vencida sempre entram primeiro; o critério ordena o restante.</p><div className="flashcard-choice-grid"><button className={criterion === "least_used" ? "choice-card active" : "choice-card"} onClick={() => setCriterion("least_used")} type="button"><Layers3 /><div><strong>Menos usadas</strong><span>Reforça palavras com pouca prática</span></div></button><button className={criterion === "oldest" ? "choice-card active" : "choice-card"} onClick={() => setCriterion("oldest")} type="button"><Clock3 /><div><strong>Há mais tempo sem usar</strong><span>Recupera vocabulário esquecido</span></div></button></div></section>
      <section className="section"><div className="top-row"><h2 className="section-title">Quantidade de palavras</h2><strong>{count}</strong></div><input aria-label="Quantidade de palavras" className="flashcard-range" min="2" max="30" onChange={(event) => setCount(Number(event.target.value))} step="1" type="range" value={count} /><div className="top-row row-meta"><span>2</span><span>30</span></div></section>
      <div className="soft-card"><Sparkles /><div><strong>Como funciona</strong><p className="row-meta">Digite ou fale sua tentativa. A resposta só aparece depois, e o treino agenda a próxima revisão pelo seu acerto e tempo de resposta.</p></div></div>
      <button className="green-button full-button" disabled={busy} onClick={() => void start("custom")} type="button">{busy ? <Loader2 className="spin" /> : <Brain />} Montar treino com {count} palavras</button>
    </> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>;
}

function cardTypeLabel(type: Flashcard["type"]) {
  if (type === "native_to_target") return "Português → idioma estudado";
  if (type === "cloze") return "Frase com lacuna";
  if (type === "listening") return "Escuta";
  return "Idioma estudado → português";
}

function matchLabel(match: AnswerMatch) {
  if (match === "exact") return "Resposta exata";
  if (match === "acceptable") return "Resposta aceita";
  if (match === "minor_error") return "Quase correta — confira acento ou artigo";
  if (match === "unknown") return "Variação não reconhecida — conta como Difícil";
  return "Resposta diferente da esperada";
}

function ratingExplanation(revealed: { forgot: boolean; match: AnswerMatch; inferredRating: RecallRating }) {
  if (revealed.forgot || revealed.match === "incorrect") return "Se você sabia e só errou na digitação, marque Lembrei — conta como Difícil.";
  if (revealed.inferredRating === "easy") return "Resposta rápida — conta como Fácil.";
  if (revealed.inferredRating === "hard") return "Quase lá — conta como Difícil.";
  return "Resposta correta.";
}

function formatAccuracy(value: number | null | undefined) { return typeof value === "number" ? `${value}%` : "—"; }
function formatIntervalDays(days: number) { return `${days} ${days === 1 ? "dia" : "dias"}`; }
function formatResponseTime(value: number | undefined) { return value ? `${(value / 1000).toFixed(1)}s` : "—"; }
function formatDuration(value: number | undefined) { return value ? `${Math.max(1, Math.round(value / 60))} min` : "—"; }
