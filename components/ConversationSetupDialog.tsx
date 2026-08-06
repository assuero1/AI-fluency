"use client";

import { Loader2, MessageCircle, Target, Users } from "lucide-react";
import { useState } from "react";
import { ModalDialog } from "./ModalDialog";

export type ConversationStartDraft = {
  title?: string;
  topicId?: string;
  mode?: string;
  source?: string;
  reason?: string;
};

export type ConfirmedConversationStart = ConversationStartDraft & {
  interactionMode: "conversation" | "simulation";
  targetUserMessageCount: number;
};

type ConversationSetupDialogProps = {
  busy: boolean;
  draft: ConversationStartDraft;
  onCancel: () => void;
  onConfirm: (input: ConfirmedConversationStart) => Promise<void> | void;
};

const MODES = ["conversation", "simulation"] as const;
type InteractionMode = (typeof MODES)[number];

export function ConversationSetupDialog({ busy, draft, onCancel, onConfirm }: ConversationSetupDialogProps) {
  const freeConversation = draft.mode === "free_conversation";
  const [interactionMode, setInteractionMode] = useState<InteractionMode>(freeConversation ? "conversation" : "conversation");
  const [goalEnabled, setGoalEnabled] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [goalTouched, setGoalTouched] = useState(false);

  const parsedTarget = goalEnabled ? Number(goalInput) : 0;
  const targetIsValid = !goalEnabled || (Number.isInteger(parsedTarget) && parsedTarget >= 1 && parsedTarget <= 50);
  const showGoalError = goalEnabled && goalTouched && !targetIsValid;

  function selectMode(mode: InteractionMode) {
    if (freeConversation) return;
    setInteractionMode(mode);
  }

  function handleModeKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
    const next = MODES[(index + direction + MODES.length) % MODES.length];
    selectMode(next);
  }

  function confirm() {
    setGoalTouched(true);
    if (!targetIsValid) return;
    void onConfirm({ ...draft, interactionMode, targetUserMessageCount: parsedTarget });
  }

  return (
    <ModalDialog
      busy={busy}
      descriptionId="conversation-setup-description"
      onClose={onCancel}
      titleId="conversation-setup-title"
    >
      <MessageCircle size={30} />
      <h2 id="conversation-setup-title" className="section-title">Configurar prática</h2>
      <p className="row-meta" id="conversation-setup-description">
        Tema: <strong>{draft.title?.trim() || "Conversa livre"}</strong>
      </p>

      <div className="conversation-setup">
        <div className="field-label">Como você quer praticar?</div>
        {freeConversation ? (
          <p className="row-meta">Conversa livre usa o modo conversa.</p>
        ) : null}
        <div className="interaction-choice-grid">
          {MODES.map((mode, index) => {
            const selected = interactionMode === mode;
            const disabled = freeConversation && mode === "simulation";
            return (
              <button
                aria-checked={selected}
                className={`interaction-choice${selected ? " selected" : ""}`}
                disabled={disabled}
                key={mode}
                onClick={() => selectMode(mode)}
                onKeyDown={(event) => handleModeKeyDown(event, index)}
                role="radio"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                {mode === "conversation" ? <MessageCircle aria-hidden="true" /> : <Users aria-hidden="true" />}
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

        <label className="goal-setting">
          <input
            checked={goalEnabled}
            disabled={busy}
            onChange={(event) => {
              setGoalEnabled(event.target.checked);
              setGoalTouched(false);
            }}
            type="checkbox"
          />
          <span>
            <Target aria-hidden="true" size={18} />
            Definir meta de mensagens
          </span>
        </label>

        {goalEnabled ? (
          <div className="goal-input-row">
            <label className="field-label" htmlFor="conversation-goal">Quantas mensagens você quer enviar?</label>
            <input
              aria-invalid={showGoalError}
              className="field-input"
              disabled={busy}
              id="conversation-goal"
              max={50}
              min={1}
              onChange={(event) => {
                setGoalInput(event.target.value);
                setGoalTouched(false);
              }}
              onBlur={() => setGoalTouched(true)}
              placeholder="1 a 50"
              step={1}
              type="number"
              value={goalInput}
            />
          </div>
        ) : null}
        {showGoalError ? (
          <div className="inline-error" role="alert">Use um número inteiro de 1 a 50.</div>
        ) : null}
      </div>

      <div className="modal-actions">
        <button className="outline-button" disabled={busy} onClick={onCancel} type="button">Cancelar</button>
        <button
          className="green-button"
          disabled={busy || (goalEnabled && !targetIsValid)}
          onClick={confirm}
          type="button"
        >
          {busy ? <Loader2 className="spin" /> : null}
          Começar prática
        </button>
      </div>
    </ModalDialog>
  );
}
