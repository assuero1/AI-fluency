"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Languages, LogOut, Mic, MicOff, Send, Shuffle } from "lucide-react";
import { TalkitoIcon } from "./TalkitoIcon";
import { Bubble } from "./Bubble";
import { IconBubble } from "./IconBubble";
import { CopyButton } from "./CopyButton";
import { ConversationGoalProgress } from "./ConversationGoalProgress";
import { LoadingDots } from "./LoadingDots";
import { LoadingScene } from "./LoadingScene";
import { ModalDialog } from "./ModalDialog";
import { Pill } from "./Pill";
import { SpiralSpinner } from "./SpiralSpinner";
import { TranslationButton } from "./TranslationButton";
import { ScreenHeader } from "./ScreenHeader";
import { TeacherChatPanel } from "./TeacherChatPanel";
import { MessageWordPlayer } from "./MessageWordPlayer";
import { VoiceButton } from "./VoiceButton";
import { HuntWordsMission } from "./HuntWordsMission";
import { parseHuntWords, detectHuntWordsInMessage, type HuntWord } from "@/lib/learning/word-hunting";
import { burstConfetti } from "@/lib/client/confetti";
import type { ConversationFields, CorrectionFields, MessageFields, WordFields } from "@/lib/learning/conversations";
import type { SelectionExplanation } from "@/lib/learning/selection-explanation";
import { resolveSelectionState } from "@/lib/learning/selection-ui";
import { joinSpeechSegments, releaseMicForPlayback, speechLanguageName, speechLocale, speechRecognitionErrorMessage } from "@/lib/learning/speech";
import { computeActiveElapsedSeconds } from "@/lib/learning/chat-elapsed";
import type { TeableRecord } from "@/lib/supabase/client";
import { playSound } from "@/lib/client/ui-sound";
import { vibrate } from "@/lib/client/haptics";
import { getMessageGoalProgress, InteractionMode, MAX_USER_MESSAGE_LENGTH, normalizeStoredInteractionMode } from "@/lib/learning/chat-contracts";

type ChatConversationProps = {
  conversation: TeableRecord<ConversationFields>;
  topicTitle: string;
  messages: TeableRecord<MessageFields>[];
  corrections: TeableRecord<CorrectionFields>[];
  speechLanguage?: string;
  audioEnabled: boolean;
  transcriptEnabled: boolean;
  readOnly: boolean;
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
  readOnly
}: ChatConversationProps) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [corrections, setCorrections] = useState(initialCorrections);
  const [selectedText, setSelectedText] = useState("");
  const [selectionContext, setSelectionContext] = useState("");
  const [selectionExplanation, setSelectionExplanation] = useState<SelectionExplanation | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [activeTopicTitle, setActiveTopicTitle] = useState(topicTitle);
  const [activeInteractionMode, setActiveInteractionMode] = useState<InteractionMode>(() =>
    normalizeStoredInteractionMode(conversation.fields.interaction_mode)
  );
  const [isTopicDialogOpen, setIsTopicDialogOpen] = useState(false);
  const [isTeacherOpen, setIsTeacherOpen] = useState(false);
  const [isExitDialogOpen, setIsExitDialogOpen] = useState(false);
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = useState(false);
  const [nextTopicTitle, setNextTopicTitle] = useState("");
  const [nextInteractionMode, setNextInteractionMode] = useState<InteractionMode>(() =>
    normalizeStoredInteractionMode(conversation.fields.interaction_mode)
  );
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  // Espera de fechamento do treino com tela própria (diferente do isSending de
  // mensagens, que usa a bolha de pensamento no feed).
  const [closing, setClosing] = useState<"none" | "finish" | "abandon">("none");
  const [isListening, setIsListening] = useState(false);
  const [speechSupport, setSpeechSupport] = useState<"checking" | "supported" | "unsupported">("checking");
  const [error, setError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [isPolishingSpeech, setIsPolishingSpeech] = useState(false);
  const huntWords = useMemo(() => parseHuntWords(conversation.fields.hunt_words), [conversation.fields.hunt_words]);
  const [foundHuntWords, setFoundHuntWords] = useState<Set<string>>(() => {
    const initialFound = new Set<string>();
    if (huntWords.length > 0) {
      for (const msg of initialMessages) {
        if (msg.fields.role === "user") {
          const found = detectHuntWordsInMessage(msg.fields.text, huntWords);
          for (const hw of found) initialFound.add(hw.wordId);
        }
      }
    }
    return initialFound;
  });
  const [huntToast, setHuntToast] = useState<string | null>(null);
  const huntToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (huntToastTimerRef.current) clearTimeout(huntToastTimerRef.current);
    };
  }, []);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const recognitionStartTextRef = useRef("");
  const speechFinalSegmentsRef = useRef<string[]>([]);
  const speechInterimRef = useRef("");
  const suppressSpeechCommitRef = useRef(false);
  const listeningDesiredRef = useRef(false);
  const recognitionRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechPolishRef = useRef<{ base: string; raw: string } | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const chatStackRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const nearChatEndRef = useRef(true);
  const selectionExplainerRef = useRef<HTMLDivElement | null>(null);
  const retryRequestRef = useRef<{ text: string; id: string } | null>(null);
  const pausedMsRef = useRef(0);
  const hiddenSinceRef = useRef<number | null>(null);
  const finalizedRef = useRef(false);
  const discardTimerRef = useRef<number | null>(null);
  const latestAssistantMessageId = findLatestAssistantMessageId(messages);
  const correctionsByMessageId = useMemo(() => {
    const grouped = new Map<string, TeableRecord<CorrectionFields>[]>();
    for (const correction of corrections) {
      const list = grouped.get(correction.fields.message_id);
      if (list) list.push(correction);
      else grouped.set(correction.fields.message_id, [correction]);
    }
    return grouped;
  }, [corrections]);

  // null = primeira medição (correções já carregadas do banco não tocam som).
  const previousCorrectionsCount = useRef<number | null>(null);
  useEffect(() => {
    if (previousCorrectionsCount.current === null) {
      previousCorrectionsCount.current = corrections.length;
      return;
    }
    if (corrections.length > previousCorrectionsCount.current) {
      playSound("neutral");
      vibrate("tap");
    }
    previousCorrectionsCount.current = corrections.length;
  }, [corrections.length]);

  const messageGoal = useMemo(
    () => getMessageGoalProgress(messages, conversation.fields.target_user_message_count),
    [messages, conversation.fields.target_user_message_count]
  );

  const requestFinalize = () => setIsFinalizeDialogOpen(true);

  // Auto-scroll da conversa: a página é o scroller, então um sentinel no fim
  // do chat-stack diz se o usuário está acompanhando o fim. Sem isso, retomar
  // caía na mensagem mais antiga e a resposta da IA aparecia fora da tela.
  const scrollToChatEnd = useCallback((behavior: ScrollBehavior) => {
    chatEndRef.current?.scrollIntoView({ behavior, block: "end" });
  }, []);

  useEffect(() => {
    const updateNearEnd = () => {
      const sentinel = chatEndRef.current;
      if (!sentinel) return;
      const rect = sentinel.getBoundingClientRect();
      nearChatEndRef.current = rect.top < window.innerHeight + 160;
    };
    updateNearEnd();
    window.addEventListener("scroll", updateNearEnd, { passive: true });
    return () => window.removeEventListener("scroll", updateNearEnd);
  }, []);

  // Ao abrir/retomar: vai direto para a última mensagem.
  useEffect(() => {
    scrollToChatEnd("auto");
  }, [scrollToChatEnd]);

  // Nova mensagem, indicador de digitação ou erro de envio: acompanha o fim,
  // mas só se o usuário não subiu de propósito para ler o histórico.
  useEffect(() => {
    if (nearChatEndRef.current) scrollToChatEnd("smooth");
  }, [messages.length, isSending, error, scrollToChatEnd]);

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
      releaseMicForPlayback();
    };
  }, []);

  useEffect(() => {
    const composer = composerInputRef.current;
    if (!composer) return;
    composer.style.height = "auto";
    composer.style.height = `${Math.min(composer.scrollHeight, 168)}px`;
  }, [text]);

  const currentPausedMs = useCallback(() => {
    const hiddenSince = hiddenSinceRef.current;
    return pausedMsRef.current + (hiddenSince === null ? 0 : Date.now() - hiddenSince);
  }, []);

  useEffect(() => {
    if (readOnly) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenSinceRef.current = Date.now();
      } else if (hiddenSinceRef.current !== null) {
        pausedMsRef.current += Date.now() - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [readOnly]);

  useEffect(() => {
    if (readOnly) return;
    // StrictMode (dev) monta/desmonta o efeito uma vez na montagem; o setup
    // cancela um descarte pendente, então só uma desmontagem real dispara.
    if (discardTimerRef.current !== null) {
      window.clearTimeout(discardTimerRef.current);
      discardTimerRef.current = null;
    }
    const handlePageHide = () => {
      if (!finalizedRef.current) discardActiveTraining(conversation.id);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
      discardTimerRef.current = window.setTimeout(() => {
        discardTimerRef.current = null;
        if (!finalizedRef.current) discardActiveTraining(conversation.id);
      }, 300);
    };
  }, [conversation.id, readOnly, router]);

  useEffect(() => {
    const chatStack = chatStackRef.current;
    if (!chatStack) return;

    const clearSelection = () => {
      setSelectedText("");
      setSelectionContext("");
      setSelectionExplanation(null);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target || selectionExplainerRef.current?.contains(target)) return;
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || selection.toString().trim() === "") clearSelection();
    };

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      const resolution = resolveSelectionState({
        text: selection?.toString() ?? "",
        isCollapsed: selection?.isCollapsed ?? true,
        rangeCount: selection?.rangeCount ?? 0,
        commonAncestor: range?.commonAncestorContainer ?? null,
        chatStack,
        explainer: selectionExplainerRef.current,
        activeElement: document.activeElement
      });
      if (resolution.action === "clear") {
        clearSelection();
        return;
      }
      if (resolution.action !== "capture" || !range) return;
      const element = range.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
      const bubble = element?.closest<HTMLElement>(".bubble");
      setSelectedText(resolution.text);
      setSelectionContext(bubble?.innerText ?? resolution.text);
      setSelectionExplanation(null);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  async function sendMessage(nextText?: string) {
    if (readOnly) return;
    const cleanText = (nextText ?? text).trim();
    if (!cleanText) return;
    speechPolishRef.current = null;
    setIsPolishingSpeech(false);

    if (isListening) {
      suppressSpeechCommitRef.current = true;
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

    const sendAbortController = new AbortController();
    const sendTimeoutId = window.setTimeout(() => sendAbortController.abort(), 40_000);

    try {
      const response = await fetch(`/api/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, clientRequestId }),
        signal: sendAbortController.signal
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        userMessage?: TeableRecord<MessageFields>;
        assistantMessage?: TeableRecord<MessageFields>;
        corrections?: TeableRecord<CorrectionFields>[];
        words?: TeableRecord<WordFields>[];
        huntWordsFound?: HuntWord[];
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

      if (data.huntWordsFound && data.huntWordsFound.length > 0) {
        const foundList = data.huntWordsFound;
        setFoundHuntWords((prev) => {
          const newlyFound = foundList.filter((hw) => !prev.has(hw.wordId));
          if (newlyFound.length === 0) return prev;

          const next = new Set(prev);
          for (const hw of newlyFound) next.add(hw.wordId);

          playSound("achievement");
          vibrate("success");
          const wordNames = newlyFound.map((hw) => `"${hw.lemma}"`).join(", ");
          const toastMsg = newlyFound.length === 1
            ? `Palavra caçada: ${wordNames}!`
            : `Palavras caçadas: ${wordNames}!`;
          setHuntToast(toastMsg);
          if (huntToastTimerRef.current) clearTimeout(huntToastTimerRef.current);
          huntToastTimerRef.current = setTimeout(() => setHuntToast(null), 3200);

          if (huntWords.length > 0 && next.size >= huntWords.length) {
            burstConfetti({ particles: 90 });
          }

          return next;
        });
      }

      retryRequestRef.current = null;
      setFailedMessage(null);
    } catch (sendError) {
      setMessages((current) => current.filter((message) => message.id !== optimisticMessageId));
      setText(cleanText);
      setFailedMessage(cleanText);
      setError(normalizeChatError(sendError, "Não foi possível continuar a conversa agora. Sua mensagem foi preservada."));
    } finally {
      window.clearTimeout(sendTimeoutId);
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
        body: JSON.stringify({ title: cleanTitle, interactionMode: nextInteractionMode })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; topic?: { fields?: { title?: string } } };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível mudar o tema.");
      setActiveTopicTitle(data.topic?.fields?.title ?? cleanTitle);
      setActiveInteractionMode(nextInteractionMode);
      setNextTopicTitle("");
      setIsTopicDialogOpen(false);
    } catch (changeError) {
      setError(normalizeChatError(changeError, "Não foi possível mudar o tema agora. Tente novamente."));
    } finally {
      setIsSending(false);
    }
  }

  async function finishConversation() {
    if (readOnly) return;
    setIsSending(true); setClosing("finish");
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${conversation.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pausedMs: currentPausedMs() })
      });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível finalizar a conversa.");
      finalizedRef.current = true;
      router.push(data.redirectTo ?? `/resumo?conversationId=${conversation.id}`);
    } catch (finishError) {
      setError(normalizeChatError(finishError, "Não foi possível finalizar a conversa agora. Tente novamente."));
    } finally {
      setIsSending(false); setClosing("none");
    }
  }

  async function abandonConversation() {
    if (readOnly) return;
    setIsSending(true); setClosing("abandon");
    setError(null);

    try {
      const response = await fetch(`/api/conversations/${conversation.id}/abandon`, { method: "POST" });
      const data = (await response.json()) as { ok?: boolean; error?: string; redirectTo?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível abandonar o treino.");
      finalizedRef.current = true;
      router.push(data.redirectTo ?? "/");
      router.refresh();
    } catch (abandonError) {
      setError(normalizeChatError(abandonError, "Não foi possível abandonar o treino agora. Tente novamente."));
      setIsExitDialogOpen(false);
      setIsSending(false); setClosing("none");
    }
  }

  async function explainSelectedText() {
    if (!selectedText) return;
    setIsExplaining(true); setError(null);
    try {
      const response = await fetch("/api/explain-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: selectedText, language: speechLanguage, context: selectionContext }) });
      const data = await response.json() as { ok?: boolean; error?: string; explanation?: SelectionExplanation };
      if (!response.ok || !data.ok || !data.explanation) throw new Error(data.error ?? "Não foi possível explicar a seleção.");
      setSelectionExplanation(data.explanation);
    } catch (explainError) { setError(normalizeChatError(explainError, "Não foi possível explicar a seleção agora.")); }
    finally { setIsExplaining(false); }
  }

  function finishRecognitionSession() {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    // No iOS, nullificar os handlers e abortar libera a AVAudioSession de gravação,
    // restaurando a rota/volume do alto-falante para o próximo TTS.
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    recognition.abort();
    recognitionRef.current = null;
    releaseMicForPlayback();
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
    suppressSpeechCommitRef.current = false;
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
      if (suppressSpeechCommitRef.current) {
        suppressSpeechCommitRef.current = false;
        speechFinalSegmentsRef.current = [];
        speechInterimRef.current = "";
        finishRecognitionSession();
        setIsListening(false);
        return;
      }

      const completedTranscript = joinSpeechSegments(
        [...speechFinalSegmentsRef.current, speechInterimRef.current].filter(Boolean),
        speechLanguage
      );
      const completedText = mergeSpeechText(recognitionStartTextRef.current, completedTranscript);
      if (completedTranscript) setText(completedText);

      if (!listeningDesiredRef.current) {
        if (completedTranscript) void polishSpeechTranscript(recognitionStartTextRef.current, completedTranscript);
        finishRecognitionSession();
        setIsListening(false);
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

  async function polishSpeechTranscript(baseText: string, rawTranscript: string) {
    speechPolishRef.current = { base: baseText, raw: rawTranscript };
    setIsPolishingSpeech(true);
    try {
      const response = await fetch("/api/speech/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: rawTranscript, language: speechLanguage })
      });
      const data = await response.json() as { ok?: boolean; text?: string; cleaned?: boolean };
      const pending = speechPolishRef.current;
      if (!pending || pending.raw !== rawTranscript) return;
      if (!response.ok || !data.ok || !data.cleaned || !data.text) return;
      const polishedText = data.text;
      setText((current) => {
        // Só substitui se o usuário não editou o campo depois do ditado.
        if (current.trim() !== mergeSpeechText(pending.base, pending.raw).trim()) return current;
        return mergeSpeechText(pending.base, polishedText);
      });
    } catch {
      // Cleanup é best-effort; o texto bruto já está no input.
    } finally {
      if (speechPolishRef.current?.raw === rawTranscript) {
        speechPolishRef.current = null;
        setIsPolishingSpeech(false);
      }
    }
  }

  return (
    <>
      <div className="top-row chat-header">
        <ScreenHeader title="Conversa" subtitle="com a IA" centered />
        {!readOnly ? (
          <button aria-label="Sair da conversa" className="ghost-icon-button" disabled={isSending} onClick={() => setIsExitDialogOpen(true)} type="button">
            <LogOut aria-hidden="true" size={24} />
          </button>
        ) : (
          <Link aria-label="Abrir calendário" className="ghost-icon-button" href="/calendario">
            <TalkitoIcon name="calendar-desk" size={24} />
          </Link>
        )}
        <ElapsedTimePill readOnly={readOnly} startedAt={conversation.fields.started_at} getPausedMs={currentPausedMs} />
      </div>

      <div className="chat-topic">
        <Bubble className="chat-topic-bubble">
          <span className="eyebrow">Tópico</span>
          <span className="chat-topic-title">{activeTopicTitle}</span>
        </Bubble>
        <div className="chat-topic-actions">
          <button
            aria-label="Chamar professor"
            className="ghost-icon-button"
            disabled={isSending}
            onClick={() => setIsTeacherOpen(true)}
            title="Chamar professor"
            type="button"
          >
            <TalkitoIcon name="teacher-chameleon" size={20} />
          </button>
          <button
            className="outline-button"
            disabled={readOnly || isSending}
            onClick={() => {
              setNextInteractionMode(activeInteractionMode);
              setIsTopicDialogOpen(true);
            }}
            type="button"
          >
            <Shuffle aria-hidden="true" size={16} /> Mudar
          </button>
        </div>
      </div>

      {huntWords.length > 0 ? (
        <HuntWordsMission huntWords={huntWords} foundWordIds={foundHuntWords} />
      ) : null}

      {huntToast ? (
        <div className="hunt-toast" role="status" aria-live="polite">
          <TalkitoIcon name="target" size={18} className="inline-block mr-1.5 align-text-bottom" />
          {huntToast}
        </div>
      ) : null}

      {isTeacherOpen ? (
        <TeacherChatPanel
          conversationId={conversation.id}
          onClose={() => setIsTeacherOpen(false)}
          topicTitle={activeTopicTitle}
        />
      ) : null}

      {isTopicDialogOpen ? (
        <ModalDialog
          busy={isSending}
          descriptionId="change-topic-description"
          onClose={() => setIsTopicDialogOpen(false)}
          titleId="change-topic-title"
        >
            <Shuffle aria-hidden="true" size={28} />
            <h2 id="change-topic-title" className="section-title">Mudar o tema da conversa?</h2>
            <p className="row-meta" id="change-topic-description">O histórico será preservado. A IA passa a conduzir a conversa pelo novo tema a partir da próxima mensagem.</p>
            <label className="field-label" htmlFor="next-topic">Novo tema</label>
            <input data-autofocus className="field-input" id="next-topic" onChange={(event) => setNextTopicTitle(event.target.value)} placeholder="Ex.: entrevista de emprego" value={nextTopicTitle} />
            <div className="field-label">Como você quer praticar o novo tema?</div>
            <div className="interaction-choice-grid">
              {(["conversation", "simulation"] as const).map((mode) => {
                const selected = nextInteractionMode === mode;
                return (
                  <button
                    aria-checked={selected}
                    className={`interaction-choice${selected ? " selected" : ""}`}
                    key={mode}
                    onClick={() => setNextInteractionMode(mode)}
                    role="radio"
                    tabIndex={selected ? 0 : -1}
                    type="button"
                  >
                    {mode === "conversation" ? <TalkitoIcon name="listening-bubble" size={20} /> : <TalkitoIcon name="users" size={20} />}
                    <span className="interaction-choice-title">{mode === "conversation" ? "Conversa" : "Simulação"}</span>
                    <span className="interaction-choice-help">
                      {mode === "conversation"
                        ? "A IA conversa com você sobre o tema."
                        : "A IA assume um papel da situação e você vive a cena."}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="modal-actions">
              <button className="outline-button" disabled={isSending} onClick={() => setIsTopicDialogOpen(false)} type="button">Cancelar</button>
              <button className="green-button" disabled={isSending || !nextTopicTitle.trim()} onClick={changeTopic} type="button">
                <TalkitoIcon name="shuffle" size={16} /> Confirmar
              </button>
            </div>
        </ModalDialog>
      ) : null}

      {isExitDialogOpen ? (
        <ModalDialog
          busy={isSending}
          descriptionId="exit-training-description"
          onClose={() => setIsExitDialogOpen(false)}
          titleId="exit-training-title"
        >
          <TalkitoIcon name="log-out" size={28} />
          <h2 id="exit-training-title" className="section-title">Abandonar este treino?</h2>
          <p className="row-meta" id="exit-training-description">
            O treino será encerrado por completo e não poderá ser retomado. Os dados já salvos, como palavras e correções, serão preservados.
          </p>
          <div className="modal-actions">
            <button data-autofocus className="outline-button" disabled={isSending} onClick={() => setIsExitDialogOpen(false)} type="button">
              Continuar treino
            </button>
            <button className="danger-button" disabled={isSending || closing === "abandon"} onClick={abandonConversation} type="button">
              {closing === "abandon" ? <SpiralSpinner label="Abandonando..." size={16} /> : <TalkitoIcon name="log-out" size={16} />} Abandonar treino
            </button>
          </div>
        </ModalDialog>
      ) : null}

      {isFinalizeDialogOpen ? (
        <ModalDialog
          busy={isSending}
          descriptionId="finalize-conversation-description"
          onClose={() => setIsFinalizeDialogOpen(false)}
          titleId="finalize-conversation-title"
        >
          <TalkitoIcon name="teacher-chameleon" size={32} />
          <h2 id="finalize-conversation-title" className="section-title">Finalizar e ver o resumo?</h2>
          <p className="row-meta" id="finalize-conversation-description">
            A conversa será encerrada e o resumo do treino será gerado. As palavras e correções já ficam valendo para a revisão.
          </p>
          <div className="modal-actions">
            <button data-autofocus className="outline-button" disabled={isSending} onClick={() => setIsFinalizeDialogOpen(false)} type="button">
              Continuar conversando
            </button>
            <button className="green-button" disabled={isSending} onClick={() => { setIsFinalizeDialogOpen(false); void finishConversation(); }} type="button">
              <TalkitoIcon name="check-stamp" size={16} /> Finalizar
            </button>
          </div>
        </ModalDialog>
      ) : null}

      {closing === "finish" ? <LoadingScene variant="overlay" moment="think" palette="chat" title="Preparando seu resumo..." /> : null}

      <div className="chat-stack" ref={chatStackRef}>
        {messages.map((message) => {
          const messageCorrections = correctionsByMessageId.get(message.id) ?? [];

          return message.fields.role === "assistant" ? (
            <div className="chat-row" key={message.id}>
              <IconBubble talkitoIcon="bot-chameleon" />
              <div className="bubble ai">
                {audioEnabled ? (
                  <MessageWordPlayer
                    languageCode={speechLanguage}
                    preload={!readOnly && message.id === latestAssistantMessageId}
                    showTranscript={transcriptEnabled}
                    text={message.fields.text}
                  />
                ) : transcriptEnabled ? message.fields.text : "Resposta da IA disponível em áudio."}
                {transcriptEnabled ? <div className="message-actions">
                  <CopyButton compact label="Copiar mensagem da IA" text={message.fields.text} />
                  <TranslationButton sourceLanguage={speechLanguage} text={message.fields.text} />
                </div> : null}
              </div>
            </div>
          ) : (
            <div key={message.id}>
              <div className="bubble user">
                {transcriptEnabled ? highlightHuntWords(message.fields.text, huntWords) : "Mensagem enviada por você."}
                {transcriptEnabled ? <div className="message-actions">
                  <CopyButton compact label="Copiar sua mensagem" text={message.fields.text} />
                  <TranslationButton sourceLanguage={speechLanguage} text={message.fields.text} />
                </div> : null}
              </div>
              {messageCorrections.map((correction) => (
                <div className="correction-block" key={correction.id}>
                  <div className="correction-title">
                    <span aria-hidden="true" className="correction-dot" />
                    Correção
                    <span className="correction-award" aria-hidden="true">+{messageCorrections.length}</span>
                  </div>
                  <div>
                    <span className="marked-error">{correction.fields.original_text}</span> →{" "}
                    <Pill tone="primary">{correction.fields.corrected_text}</Pill>
                  </div>
                  <div className="correction-title warning">
                    <span aria-hidden="true" className="correction-dot" />
                    Por que isso importa?
                  </div>
                  <p className="row-meta">{correction.fields.explanation}</p>
                  <CopyButton label="Copiar correção" text={correction.fields.corrected_text} />
                  {audioEnabled ? <VoiceButton languageCode="pt-BR" text={correction.fields.explanation} label="Ouvir explicação" /> : null}
                </div>
              ))}
            </div>
          );
        })}

        {isSending && closing === "none" ? (
          <div className="chat-row">
            <IconBubble talkitoIcon="bot-chameleon" />
            <div className="bubble ai typing-bubble">
              <LoadingDots srText="A IA está respondendo..." />
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

        {selectedText ? <div className="selection-explainer" ref={selectionExplainerRef}>
          <div><span className="eyebrow">Trecho selecionado</span><strong>{selectedText}</strong></div>
          <button className="outline-button" disabled={isExplaining} onClick={explainSelectedText} type="button"><Languages aria-hidden="true" size={16} /> {isExplaining ? "Explicando..." : "Explicar seleção"}</button>
          {selectionExplanation ? <div className="selection-explanation" aria-live="polite">
            <p><strong>Tradução:</strong> {selectionExplanation.translation}</p>
            <p><strong>Gramática:</strong> {selectionExplanation.grammar}</p>
            <p><strong>Como usar:</strong> {selectionExplanation.usage}</p>
            {selectionExplanation.example ? <p><strong>Exemplo:</strong> {selectionExplanation.example}</p> : null}
          </div> : null}
        </div> : null}

        {!readOnly ? <button className="outline-button full-button finalize-bar" disabled={isSending} onClick={requestFinalize} type="button">
          <Check aria-hidden="true" size={20} /> Finalizar conversa
        </button> : <div className="empty-state">Esta conversa foi finalizada e está disponível apenas para consulta.</div>}

        <ConversationGoalProgress progress={messageGoal} readOnly={readOnly} />

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
            {speechSupport === "unsupported" ? <MicOff aria-hidden="true" size={20} /> : <Mic aria-hidden="true" size={20} />}
          </button>
          <textarea
            aria-label="Mensagem para a IA"
            className="composer-input"
            disabled={isSending}
            maxLength={MAX_USER_MESSAGE_LENGTH}
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
            <Send aria-hidden="true" size={20} />
          </button>
        </form> : null}
        {!readOnly ? (
          <p className="speech-status" id="speech-recognition-status" aria-live="polite">
            {speechSupport === "unsupported"
              ? "Reconhecimento de voz indisponível neste navegador. A digitação continua disponível."
              : isListening
                ? `Ouvindo em ${speechLanguageName(speechLanguage)}. Pressione o microfone novamente para parar.`
                : isPolishingSpeech
                  ? "Ajustando o texto ditado..."
                  : `Reconhecimento de voz: ${speechLanguageName(speechLanguage)}.`}
          </p>
        ) : null}
        <div ref={chatEndRef} aria-hidden="true" />
      </div>
    </>
  );
}

function ElapsedTimePill({ startedAt, readOnly, getPausedMs }: { startedAt: string; readOnly: boolean; getPausedMs?: () => number }) {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => computeActiveElapsedSeconds(startedAt, getPausedMs?.() ?? 0));

  useEffect(() => {
    if (readOnly) return;
    const timer = window.setInterval(() => setElapsedSeconds(computeActiveElapsedSeconds(startedAt, getPausedMs?.() ?? 0)), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt, readOnly, getPausedMs]);

  return <Pill aria-label={`Tempo de conversa: ${formatElapsedTime(elapsedSeconds)}`}><TalkitoIcon name="clock-timer" size={16} /> {formatElapsedTime(elapsedSeconds)}</Pill>;
}

function createClientRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `message-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function discardActiveTraining(conversationId: string) {
  const url = `/api/conversations/${conversationId}/abandon`;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function" && navigator.sendBeacon(url)) return;
  } catch {
    // Cai para o fetch keepalive abaixo.
  }
  void fetch(url, { method: "POST", keepalive: true }).catch(() => undefined);
}

function formatElapsedTime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function mergeSpeechText(existing: string, transcript: string) {
  return [existing.trim(), transcript.trim()].filter(Boolean).join(" ");
}

function normalizeChatError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || /the string did not match the expected pattern|invalidstateerror|failed to fetch|fetch failed|networkerror|network request failed|load failed|unexpected (end|token).*json|the operation (was aborted|timed out)|signal (is|was) aborted|\babort(ed)?\b|timed? ?out/i.test(message)) {
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
      // Optimistic local message — never persisted, so no real user id exists here.
      user_id: "",
      conversation_id: conversationId,
      role: "user",
      text,
      audio_url: "",
      transcript_text: text,
      language_detected: languageCode ?? "",
      tokens_used: 0,
      channel: "practice",
      created_at: new Date().toISOString()
    }
  };
}

function highlightHuntWords(text: string, huntWords: HuntWord[]): React.ReactNode {
  if (!huntWords.length || !text) return text;
  const candidates = huntWords
    .flatMap((hw) => [hw.lemma, ...hw.forms])
    .map((c) => c.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!candidates.length) return text;

  try {
    const escaped = candidates.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    const regex = new RegExp(`(?<![\\p{L}\\p{N}_])(${escaped})(?![\\p{L}\\p{N}_])`, "giu");
    const parts = text.split(regex);
    if (parts.length === 1) return text;

    const candidateSet = new Set(candidates.map((c) => c.toLowerCase()));
    return parts.map((part, index) => {
      if (candidateSet.has(part.toLowerCase())) {
        return (
          <mark className="golden-trigger" key={index}>
            {part}
          </mark>
        );
      }
      return part;
    });
  } catch {
    return text;
  }
}
