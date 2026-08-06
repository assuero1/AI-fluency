"use client";

import { Bot, GraduationCap, Loader2, Send, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { LoadingDots } from "./LoadingDots";
import { IconBubble } from "./IconBubble";
import { ModalDialog } from "./ModalDialog";
import type { MessageFields } from "@/lib/learning/conversations";
import type { TeableRecord } from "@/lib/teable/client";

type TeacherChatPanelProps = {
  conversationId: string;
  topicTitle: string;
  onClose: () => void;
};

type TeacherMessage = TeableRecord<MessageFields>;

type TeacherLoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; messages: TeacherMessage[] };

export function TeacherChatPanel({ conversationId, topicTitle, onClose }: TeacherChatPanelProps) {
  const [loadState, setLoadState] = useState<TeacherLoadState>({ status: "loading" });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const historyRef = useRef<HTMLDivElement | null>(null);
  const retryRequestRef = useRef<{ text: string; id: string } | null>(null);
  const focusedAfterLoadRef = useRef(false);

  const loadHistory = useCallback(async () => {
    setLoadState({ status: "loading" });
    try {
      const response = await fetch(`/api/conversations/${conversationId}/teacher/messages`);
      const data = (await response.json()) as { ok?: boolean; error?: string; messages?: TeacherMessage[] };
      if (!response.ok || !data.ok || !data.messages) throw new Error(data.error ?? "Não foi possível carregar o professor.");
      setLoadState({ status: "ready", messages: sortByCreatedAt(data.messages) });
    } catch (loadError) {
      setLoadState({ status: "error", message: normalizeTeacherError(loadError, "Não foi possível carregar a conversa com o professor.") });
    }
  }, [conversationId]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    if (loadState.status === "ready" && !focusedAfterLoadRef.current) {
      focusedAfterLoadRef.current = true;
      composerRef.current?.focus();
    }
  }, [loadState]);

  useEffect(() => {
    const history = historyRef.current;
    if (history && loadState.status === "ready") {
      history.scrollTop = history.scrollHeight;
    }
  }, [loadState]);

  async function sendQuestion(nextText?: string) {
    if (busy) return;
    const cleanText = (nextText ?? text).trim();
    if (!cleanText) return;

    const clientRequestId = retryRequestRef.current?.text === cleanText
      ? retryRequestRef.current.id
      : createTeacherRequestId();
    const optimisticId = `optimistic-teacher-${clientRequestId}`;
    retryRequestRef.current = { text: cleanText, id: clientRequestId };
    const optimisticMessage: TeacherMessage = {
      id: optimisticId,
      fields: {
        conversation_id: conversationId,
        role: "user",
        text: cleanText,
        audio_url: "",
        transcript_text: cleanText,
        language_detected: "pt-BR",
        tokens_used: 0,
        channel: "teacher",
        created_at: new Date().toISOString()
      }
    };

    setLoadState((current) =>
      current.status === "ready"
        ? { status: "ready", messages: [...current.messages.filter((message) => message.id !== optimisticId), optimisticMessage] }
        : current
    );
    setBusy(true);
    setSendError(null);
    setFailedDraft(null);
    setText("");

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => abortController.abort(), 40_000);

    try {
      const response = await fetch(`/api/conversations/${conversationId}/teacher/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanText, clientRequestId }),
        signal: abortController.signal
      });
      const data = (await response.json()) as {
        ok?: boolean;
        error?: string;
        userMessage?: TeacherMessage;
        assistantMessage?: TeacherMessage;
      };
      if (!response.ok || !data.ok || !data.userMessage || !data.assistantMessage) {
        throw new Error(data.error ?? "Não foi possível enviar sua dúvida.");
      }

      setLoadState((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              messages: sortByCreatedAt([
                ...current.messages.filter((message) =>
                  message.id !== optimisticId && message.id !== data.userMessage!.id && message.id !== data.assistantMessage!.id
                ),
                data.userMessage!,
                data.assistantMessage!
              ])
            }
          : current
      );
      retryRequestRef.current = null;
    } catch (sendQuestionError) {
      setLoadState((current) =>
        current.status === "ready"
          ? { status: "ready", messages: current.messages.filter((message) => message.id !== optimisticId) }
          : current
      );
      setText(cleanText);
      setFailedDraft(cleanText);
      setSendError(normalizeTeacherError(sendQuestionError, "Não foi possível enviar sua dúvida agora. O texto foi preservado."));
    } finally {
      window.clearTimeout(timeoutId);
      setBusy(false);
    }
  }

  const readyMessages = loadState.status === "ready" ? loadState.messages : [];
  const latestAssistantText = readyMessages.filter((message) => message.fields.role === "assistant").at(-1)?.fields.text;

  return (
    <ModalDialog
      busy={busy}
      className="teacher-chat-modal"
      descriptionId="teacher-chat-description"
      onClose={onClose}
      titleId="teacher-chat-title"
    >
      <div className="teacher-chat-header">
        <div className="teacher-chat-heading">
          <GraduationCap aria-hidden="true" size={26} />
          <div>
            <h2 id="teacher-chat-title" className="section-title">Professor de IA</h2>
            <p className="row-meta" id="teacher-chat-description">Dúvidas sobre esta prática: {topicTitle}</p>
          </div>
        </div>
        <button
          aria-label="Fechar professor"
          className="teacher-chat-close"
          disabled={busy}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" />
        </button>
      </div>

      <p className="teacher-chat-notice">Este chat não conta na sua meta e não altera a conversa principal.</p>

      <div className="teacher-chat-history" ref={historyRef}>
        {loadState.status === "loading" ? (
          <div className="teacher-chat-state">
            <LoadingDots srText="Carregando conversa com o professor..." />
            <span>Carregando conversa com o professor...</span>
          </div>
        ) : null}

        {loadState.status === "error" ? (
          <div className="teacher-chat-state">
            <div className="inline-error" role="alert">{loadState.message}</div>
            <button className="outline-button" onClick={() => void loadHistory()} type="button">
              Tentar carregar novamente
            </button>
          </div>
        ) : null}

        {loadState.status === "ready" && readyMessages.length === 0 ? (
          <div className="teacher-chat-state empty">
            Pergunte sobre uma frase, correção, palavra ou sobre como responder na situação.
          </div>
        ) : null}

        {loadState.status === "ready" && readyMessages.length > 0 ? (
          <div className="teacher-chat-list">
            {readyMessages.map((message) =>
              message.fields.role === "assistant" ? (
                <div className="chat-row" key={message.id}>
                  <IconBubble Icon={Bot} tone="info" />
                  <div className="bubble teacher-ai">{message.fields.text}</div>
                </div>
              ) : (
                <div className="chat-row teacher-user-row" key={message.id}>
                  <div className="bubble teacher-user">{message.fields.text}</div>
                </div>
              )
            )}
          </div>
        ) : null}
        <p className="sr-only" aria-live="polite">{latestAssistantText ?? ""}</p>
      </div>

      {sendError ? (
        <div className="inline-error chat-recovery" role="alert">
          <span>{sendError}</span>
          {failedDraft ? (
            <button disabled={busy} onClick={() => sendQuestion(failedDraft)} type="button">
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        className="composer teacher-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void sendQuestion();
        }}
      >
        <textarea
          aria-label="Pergunta para o professor"
          className="composer-input"
          disabled={busy || loadState.status !== "ready"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void sendQuestion();
            }
          }}
          placeholder="Tire sua dúvida com o professor..."
          ref={composerRef}
          rows={1}
          value={text}
        />
        <button className="send-button" disabled={busy || !text.trim() || loadState.status !== "ready"} type="submit" aria-label="Enviar pergunta ao professor">
          {busy ? <Loader2 className="spin" /> : <Send />}
        </button>
      </form>
    </ModalDialog>
  );
}

function sortByCreatedAt(messages: TeacherMessage[]) {
  return [...messages].sort((left, right) => new Date(left.fields.created_at).getTime() - new Date(right.fields.created_at).getTime());
}

function createTeacherRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `teacher-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTeacherError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message.trim() : "";
  if (!message || /failed to fetch|fetch failed|networkerror|network request failed|load failed|unexpected (end|token).*json|the operation (was aborted|timed out)|signal (is|was) aborted|\babort(ed)?\b|timed? ?out/i.test(message)) {
    return fallback;
  }
  return message;
}
