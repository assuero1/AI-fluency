"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { TalkitoIcon } from "./TalkitoIcon";

type AddSenseFormProps = {
  wordId: string;
};

export function AddSenseForm({ wordId }: AddSenseFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [translation, setTranslation] = useState("");
  const [partOfSpeech, setPartOfSpeech] = useState("");
  const [exampleSentence, setExampleSentence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const translationRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) translationRef.current?.focus();
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !translation.trim()) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/words/${wordId}/senses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translation: translation.trim(),
          partOfSpeech: partOfSpeech.trim() || undefined,
          exampleSentence: exampleSentence.trim() || undefined
        })
      });
      const data = await response.json() as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível adicionar o significado.");
      setTranslation("");
      setPartOfSpeech("");
      setExampleSentence("");
      setOpen(false);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Não foi possível adicionar o significado.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="outline-button full-button" onClick={() => setOpen(true)} type="button">
        <TalkitoIcon name="plus" size={18} /> Adicionar significado
      </button>
    );
  }

  return (
    <form className="add-sense-form" onSubmit={submit}>
      <div>
        <label className="field-label" htmlFor="add-sense-translation">Novo significado em português</label>
        <input
          autoComplete="off"
          className="field-input"
          id="add-sense-translation"
          maxLength={200}
          onChange={(event) => setTranslation(event.target.value)}
          placeholder="Ex.: banco (instituição financeira)"
          ref={translationRef}
          required
          value={translation}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="add-sense-pos">Classe gramatical (opcional)</label>
        <input
          autoComplete="off"
          className="field-input"
          id="add-sense-pos"
          maxLength={60}
          onChange={(event) => setPartOfSpeech(event.target.value)}
          placeholder="Ex.: substantivo"
          value={partOfSpeech}
        />
      </div>
      <div>
        <label className="field-label" htmlFor="add-sense-example">Frase de exemplo (opcional)</label>
        <input
          autoComplete="off"
          className="field-input"
          id="add-sense-example"
          maxLength={300}
          onChange={(event) => setExampleSentence(event.target.value)}
          placeholder="Ex.: El banco cierra a las dos."
          value={exampleSentence}
        />
      </div>
      {error ? <p className="inline-error" role="alert">{error}</p> : null}
      <div className="modal-actions">
        <button className="outline-button" disabled={busy} onClick={() => { setOpen(false); setError(""); }} type="button">Cancelar</button>
        <button className="green-button" disabled={busy || !translation.trim()} type="submit">
          {busy ? <TalkitoIcon name="loader" size={18} /> : <TalkitoIcon name="plus" size={18} />} Salvar significado
        </button>
      </div>
    </form>
  );
}
