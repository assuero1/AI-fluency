"use client";

import { BookOpen, Bot, CalendarDays, ChevronRight, Flame, Loader2, Mic, MicOff, Send, Shuffle, Volume2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { IconBubble } from "./IconBubble";
import { CopyButton } from "./CopyButton";
import { ModalDialog } from "./ModalDialog";
import { Pill } from "./Pill";
import { TranslationButton } from "./TranslationButton";
import { ScreenHeader } from "./ScreenHeader";
import { VoiceButton } from "./VoiceButton";
import type { ConversationFields, CorrectionFields, MessageFields, WordFields } from "@/lib/learning/conversations";
import { joinSpeechSegments, speechLanguageName, speechLocale, speechRecognitionErrorMessage } from "@/lib/learning/speech";
import { formatPracticeStreak } from "@/lib/learning/practice-activity";
import type { TeableRecord } from "@/lib/teable/client";
import type { ConversationQuickAction } from "@/lib/learning/quick-actions";

type ChatConversationProps = {
  conversation: TeableRecord<ConversationFields>;
  topicTitle: string;
  messages: TeableRecord<MessageFields>[];
  corrections: TeableRecord<CorrectionFields>[];
  speechLanguage?: string;
  audioEnabled: boolean;
  transcriptEnabled: boolean;
  readOnly: boolean;
  streak: number;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

type SpeechRecognitionInstance = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: {
      transcript: string;
    };
  }>;
};

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export function ChatConversation({
  conversation,
  topicTitle,
  messages: initialMessages,
  corrections: initialCorrections,
  speechLanguage,
  audioEnabled,
  transcriptEnabled,
  readOnly,
  streak
}: ChatConversationProps) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [corrections, setCorrections] = useState(initialCorrections);
  const [savedWordsCount, setSavedWordsCount] = useState(0);
  const [activeTopicTitle, setActiveTopicTitle] = useState(topicTitle);
  const [isTopicDialogOpen, setIsTopicDialogOpen] = useState(false);
  const [nextTopicTitle, setNextTopicTitle] = useState("");
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [pendingQuickAction, setPendingQuickAction] = useState<ConversationQuickAction | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechSupport, setSpeechSupport] = useState<"checking" | "supported" | "unsupported">("checking");
  const [error, setError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recognitionStartTextRef = useRef("");
  const speechFinalSegmentsRef = useRef<string[]>([]);
  const speechInterimRef = useRef("");
  const listeningDesiredRef = useRef(false);
  const recognitionRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const retryRequestRef = useRef<{ text: string; id: string } | null>(null);
  const latestAssistantMessageId = findLatestAssistantMessageId(messages);

  useEffect(() => {
    const speechWindow = window as SpeechWindow;
    setSpeechSupport(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition ? "supported" : "unsupported");
    return () => {
      listeningDesiredRef.current = false;
      if (recognitionRestartTimerRef.current) clearTimeout(recognitionRestartTimerRef.current);
      const recognition = recognitionRef.current;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
      recognitionRef.current = null;
    };
  }, []);

  useEffect(() => {
    const composer = composerInputRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 168)}px`;
  }, [text]);

  async function sendMessage(nextText?: string) {
    if (readOnly) return;
    const cleanText = (nextText ?? text).trim();
    if (!cleanText) return;

    if (isListening) {
      listeningDesiredRef.current = false;
      recognitionRef.current?.stop();
      setIsListening(false);
    }

    const clientRequestId = retryRequestRef.current?.text === cleanText
      ? retryRequestRef.current.id
      : createClientRequestId();
    const optimisticMessageId = `optimistic-${clientRequestId}`;
    retryRequestRef.current = { text: cleanText, id: clientRequestId };
    setMessages((current) => [
      ...current.filter((message) => message.id !== optimisticMessageId),
      createOptimisticUserMessage(optimisticMessageId, conversation.id, cleanText, speechLanguage)
    ]);
    setIsSending(true);
    setError(null);
    setFailedMessage(null);
    setText("");

    try {
      const response = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, clientRequestId })
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        userMessage?: TeableRecord<MessageFields>;
        assistantMessage?: TeableRecord<MessageFields>;
        corrections?: TeableRecord<CorrectionFields>[];
        words?: TeableRecord<WordFields>[];
      };

      if (!response.ok || !data.ok || !data.userMessage || !data.assistantMessage) {
        throw new Error(data.error ?? "Não foi possível enviar sua mensagem.");
      }

      setMessages((current) => [
        ...current.filter((message) =>
          message.id !== optimisticMessageId && message.id !== data.userMessage!.id && message.id !== data.assistantMessage!.id
        ),
        data.userMessage!,
        data.assistantMessage!
      ]);
      setCorrections((current) => [...current, ...(data.corrections ?? [])]);
      setSavedWordsCount(data.words?.length ?? 0);
      retryRequestRef.current = null;
      setFailedMessage(null);
    } catch (sendError) {
      setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
      setText(cleanText);
      setFailedMessage(cleanText);
      setError(normalizeChatError(sendError, "Não foi possível continuar a conversa agora. Sua mensagem foi preservada."));
    } finally {
      setIsSending(false);
    }
  }

  async function changeTopic() {
    const cleanTitle = nextTopicTitle.trim();
    if (!cleanTitle || readOnly) return;
    setIsSending(true);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/topic`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: cleanTitle })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; topic?: { fields?: { title?: string } } };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível mudar o tema.");
      setActiveTopicTitle(data.topic?.fields?.title ?? cleanTitle);
      setNextTopicTitle("");
      setIsTopicDialogOpen(false);
      router.refresh();
    } catch (changeError) {
      setError(normalizeChatError(changeError, "Não foi possível mudar o tema agora. Tente novamente."));
    } finally {
      setIsSending(false);
    }
  }

  async function runQuickAction(action: ConversationQuickAction) {
    if (readOnly || isSending) return;
    setIsSending(true);
    setPendingQuickAction(action);
    setError(null);
    try {
      const response = await fetch(`/api/conversations/${conversation.id}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; assistantMessage?: TeableRecord<MessageFields> };
      if (!response.ok || !data.ok || !data.assistantMessage) throw new Error(data.error ?? "Não foi possível executar esta ação.");
      setMessages((current) => [...current, data.assistantMessage!]);
    } catch (actionError) {
      setError(normalizeChatError(actionError, "Não foi possível executar esta ação agora. Tente novamente."));
    } finally {
      setPendingQuickAction(null);
      setIsSending(false);
    }
  }

  async function finishConversation() {
    if (readOnly) return;
    setIsSending(true);
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${conversation.id}/end`, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível finalizar a conversa.");
      router.push(data.redirectTo ?? `/resumo?conversationId=${conversation.id}`);
    } catch (finishError) {
      setError(normalizeChatError(finishError, "Não foi possível finalizar a conversa agora. Tente novamente."));
    } finally {
      setIsSending(false);
    }
  }

  function toggleNativeSpeechRecognition() {
    if (isSending) return;

    if (isListening) {
      listeningDesiredRef.current = false;
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition =
      typeof window !== "undefined"
        ? (window as SpeechWindow).SpeechRecognition ?? (window as SpeechWindow).webkitSpeechRecognition
        : undefined;

    if (!SpeechRecognition) {
      setSpeechSupport("unsupported");
      setError("Reconhecimento de voz indisponível neste navegador. Você ainda pode digitar normalmente.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = speechLocale(speechLanguage);
    recognition.interimResults = true;
    recognition.continuous = true;
    recognitionStartTextRef.current = text.trim();
    speechFinalSegmentsRef.current = [];
    speechInterimRef.current = "";
    listeningDesiredRef.current = true;
    setIsListening(true);
    setError(null);

    recognition.onresult = (event) => {
      const finalSegments: string[] = [];
      let interimTranscript = "";

      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result[0].transcript.trim();
        if (!transcript) continue;
        if (result.isFinal) finalSegments.push(transcript);
        else interimTranscript += `${interimTranscript ? " " : ""}${transcript}`;
      }

      speechFinalSegmentsRef.current = finalSegments;
      speechInterimRef.current = interimTranscript;
      const liveTranscript = [...finalSegments, interimTranscript].filter(Boolean).join(" ");
      if (liveTranscript) setText(mergeSpeechText(recognitionStartTextRef.current, liveTranscript));
    };

    recognition.onerror = (event) => {
      listeningDesiredRef.current = false;
      setIsListening(false);
      const message = speechRecognitionErrorMessage(event.error);
      if (message) setError(message);
    };

    recognition.onend = () => {
      const completedTranscript = joinSpeechSegments(
        [...speechFinalSegmentsRef.current, speechInterimRef.current].filter(Boolean),
        speechLanguage
      );
      const completedText = mergeSpeechText(recognitionStartTextRef.current, completedTranscript);
      if (completedTranscript) setText(completedText);

      if (!listeningDesiredRef.current) {
        setIsListening(false);
        recognitionRef.current = null;
        return;
      }

      recognitionStartTextRef.current = completedText;
      speechFinalSegmentsRef.current = [];
      speechInterimRef.current = "";
      recognitionRestartTimerRef.current = setTimeout(() => {
        try {
          recognition.start();
        } catch (restartError) {
          listeningDesiredRef.current = false;
          recognitionRef.current = null;
          setIsListening(false);
          setError(normalizeChatError(restartError, "O ditado foi interrompido. Toque no microfone para continuar."));
        }
      }, 250);
    };

    try {
      recognition.start();
    } catch (startError) {
      listeningDesiredRef.current = false;
      recognitionRef.current = null;
      setIsListening(false);
      setError(normalizeChatError(startError, "Não foi possível iniciar o ditado. Tente novamente."));
    }
  }

  return (
    <>
      <div className="top-row chat-header">
        <Pill aria-label={`Sequência atual: ${formatPracticeStreak(streak)}`}>
          <Flame aria-hidden="true" size={18} color="#f59d1f" fill="#f59d1f" /> {formatPracticeStreak(streak)}
        </Pill>
        <ScreenHeader title="Conversa" subtitle="com a IA" centered />
        <Link className="outline-button" href="/calendario" aria-label="Abrir calendário">
          <CalendarDays />
        </Link>
      </div>

      <div className="chat-topic">
        <div className="topic-pill">
          <IconBubble Icon={Volume2} tone="danger" />
          <div className="row-copy">
            <div className="eyebrow">Tópico</div>
            <div className="row-title">{activeTopicTitle}</div>
          </div>
          <ChevronRight />
        </div>
        <button className="outline-button" disabled={readOnly || isSending} onClick={() => setIsTopicDialogOpen(true)} type="button">
          <Shuffle /> Mudar
        </button>
      </div>

      {isTopicDialogOpen ? (
        <ModalDialog
          busy={isSending}
          descriptionId="change-topic-description"
          onClose={() => setIsTopicDialogOpen(false)}
          titleId="change-topic-title"
        >
            <Shuffle color="#2f9d4a" size={30} />
            <h2 id="change-topic-title" className="section-title">Mudar o tema da conversa?</h2>
            <p className="row-meta" id="change-topic-description">O histórico será preservado. A IA passa a conduzir a conversa pelo novo tema a partir da próxima mensagem.</p>
            <label className="field-label" htmlFor="next-topic">Novo tema</label>
            <input data-autofocus className="field-input" id="next-topic" onChange={(event) => setNextTopicTitle(event.target.value)} placeholder="Ex.: entrevista de emprego" value={nextTopicTitle} />
            <div className="modal-actions">
              <button className="outline-button" disabled={isSending} onClick={() => setIsTopicDialogOpen(false)} type="button">Cancelar</button>
              <button className="green-button" disabled={isSending || !nextTopicTitle.trim()} onClick={changeTopic} type="button">
                {isSending ? <Loader2 className="spin" /> : <Shuffle />} Confirmar
              </button>
            </div>
        </ModalDialog>
      ) : null}

      <div className="chat-stack">
        {messages.map((message) => {
          const messageCorrections = corrections.filter((correction) => correction.fields.message_id === message.id);

          return message.fields.role === "assistant" ? (
            <div className="chat-row" key={message.id}>
              <IconBubble Icon={Bot} />
              <div className="bubble ai">
                {transcriptEnabled ? message.fields.text : "Resposta da IA disponível em áudio."}
                {transcriptEnabled ? <div className="message-actions">
                  <CopyButton compact label="Copiar mensagem da IA" text={message.fields.text} />
                  <TranslationButton sourceLanguage={speechLanguage} text={message.fields.text} />
                </div> : null}
                {audioEnabled ? (
                  <VoiceButton
                    languageCode={speechLanguage}
                    label="Ouvir mensagem"
                    preload={!readOnly && message.id === latestAssistantMessageId}
                    text={message.fields.text}
                  />
                ) : null}
              </div>
            </div>
          ) : (
            <div key={message.id}>
              <div className="bubble user">
                {transcriptEnabled ? message.fields.text : "Mensagem enviada por você."}
                {transcriptEnabled ? <div className="message-actions">
                  <CopyButton compact label="Copiar sua mensagem" text={message.fields.text} />
                  <TranslationButton sourceLanguage={speechLanguage} text={message.fields.text} />
                </div> : null}
              </div>
              {messageCorrections.map((correction) => (
                <div className="correction-block" key={correction.id}>
                  <div className="correction-title">
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: "currentColor" }} />
                    Correção
                  </div>
                  <div>
                    <span className="marked-error">{correction.fields.original_text}</span> →{" "}
                    <Pill tone="primary">{correction.fields.corrected_text}</Pill>
                  </div>
                  <div className="correction-title" style={{ color: "var(--warning)" }}>
                    <span style={{ width: 10, height: 10, borderRadius: 999, background: "currentColor" }} />
                    Por que isso importa?
                  </div>
                  <p style={{ margin: 0 }}>{correction.fields.explanation}</p>
                  <CopyButton label="Copiar correção" text={correction.fields.corrected_text} />
                  {audioEnabled ? <VoiceButton languageCode="pt-BR" text={correction.fields.explanation} label="Ouvir explicação" /> : null}
                </div>
              ))}
            </div>
          );
        })}

        {isSending ? (
          <div className="chat-row">
            <IconBubble Icon={Bot} />
            <div className="bubble ai typing-bubble">
              <Loader2 className="spin" /> A IA está preparando a próxima resposta...
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="inline-error chat-recovery" role="alert">
            <span>{error}</span>
            {failedMessage ? (
              <button disabled={isSending} onClick={() => sendMessage(failedMessage)} type="button">
                Tentar novamente
              </button>
            ) : null}
          </div>
        ) : null}

        <Link
          aria-label={savedWordsCount > 0 ? `Abrir ${savedWordsCount} palavras salvas` : "Abrir vocabulário"}
          className={savedWordsCount > 0 ? "saved-words" : "saved-words muted-saved-words"}
          href="/palavras"
        >
          <span>
            <BookOpen size={22} />{" "}
            {savedWordsCount > 0 ? `${savedWordsCount} novas palavras salvas` : "Palavras salvas aparecem aqui"}
          </span>
          <ChevronRight />
        </Link>

        {!readOnly ? <div className="quick-actions">
          <button className="outline-button" disabled={isSending} onClick={() => runQuickAction("explain")} type="button">
            {pendingQuickAction === "explain" ? <Loader2 className="spin" /> : null} Explicar
          </button>
          <button className="outline-button" disabled={isSending} onClick={() => runQuickAction("repeat")} type="button">
            {pendingQuickAction === "repeat" ? <Loader2 className="spin" /> : null} Repetir
          </button>
          <button className="outline-button" disabled={isSending} onClick={() => runQuickAction("harder")} type="button">
            {pendingQuickAction === "harder" ? <Loader2 className="spin" /> : null} Mais difícil
          </button>
        </div> : null}

        {!readOnly ? <button className="green-button full-button" disabled={isSending} onClick={finishConversation} type="button">
          {isSending ? <Loader2 className="spin" /> : null}
          Finalizar conversa
        </button> : <div className="empty-state">Esta conversa foi finalizada e está disponível apenas para consulta.</div>}

        {!readOnly ? <form
          className="composer"
          onSubmit={(event) => {
            event.preventDefault();
            sendMessage();
          }}
        >
          <button
            className={isListening ? "mic-button listening" : "mic-button"}
            aria-describedby="speech-recognition-status"
            disabled={isSending || speechSupport === "checking"}
            onClick={toggleNativeSpeechRecognition}
            type="button"
            aria-label={isListening ? "Parar transcrição" : "Falar mensagem"}
            title={isListening ? "Parar transcrição" : `Falar em ${speechLanguageName(speechLanguage)}`}
          >
            {speechSupport === "unsupported" ? <MicOff /> : <Mic />}
          </button>
          <textarea
            aria-label="Mensagem para a IA"
            className="composer-input"
            disabled={isSending}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                sendMessage();
              }
            }}
            placeholder={isListening ? "Ouvindo..." : "Escreva ou fale sua mensagem..."}
            ref={composerInputRef}
            rows={1}
            value={text}
          />
          <button className="send-button" disabled={isSending || !text.trim()} type="submit" aria-label="Enviar mensagem">
            {isSending ? <Loader2 className="spin" /> : <Send color="#2f9d4a" />}
          </button>
        </form> : null}
        {!readOnly ? (
          <p className="speech-status" id="speech-recognition-status" aria-live="polite">
            {speechSupport === "unsupported"
              ? "Reconhecimento de voz indisponível neste navegador. A digitação continua disponível."
              : isListening
                ? `Ouvindo em ${speechLanguageName(speechLanguage)}. Pressione o microfone novamente para parar.`
                : `Reconhecimento de voz: ${speechLanguageName(speechLanguage)}.`}
          </p>
        ) : null}
      </div>
    </>
  );
}

function createClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `message-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function mergeSpeechText(existing: string, transcript: string) {
  return [existing.trim(), transcript.trim()].filter(Boolean).join(" ");
}

function normalizeChatError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || /the string did not match the expected pattern|invalidstateerror|failed to fetch|networkerror|network request failed|load failed|unexpected (end|token).*json/i.test(message)) {
    return fallback;
  }
  return message;
}

function findLatestAssistantMessageId(messages: TeableRecord<MessageFields>[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].fields.role === "assistant") return messages[index].id;
  }
  return null;
}

function createOptimisticUserMessage(
  id: string,
  conversationId: string,
  text: string,
  languageCode: string | undefined
): TeableRecord<MessageFields> {
  return {
    id,
    fields: {
      Name: text.slice(0, 80),
      conversation_id: conversationId,
      role: "user",
      text,
      audio_url: "",
      transcript_text: text,
      language_detected: languageCode ?? "",
      tokens_used: 0,
      created_at: new Date().toISOString()
    }
  };
}
