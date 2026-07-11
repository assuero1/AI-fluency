"use client";

import { BookOpen, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VocabularyCandidate } from "@/lib/learning/vocabulary-selection";

export function VocabularyPicker({ conversationId, candidates, savedIds }: {
  conversationId: string;
  candidates: VocabularyCandidate[];
  savedIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(new Set(savedIds));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const groups = [
    { source: "user" as const, title: "Palavras que você usou" },
    { source: "assistant" as const, title: "Palavras usadas pela IA" }
  ];

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/conversations/${conversationId}/vocabulary`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: [...selected] })
      });
      const data = await response.json() as { ok?: boolean; error?: string; savedCount?: number };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível salvar as palavras.");
      setMessage(`${data.savedCount ?? 0} palavra(s) adicionada(s) ao vocabulário.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar as palavras.");
    } finally { setSaving(false); }
  }

  return <section className="section vocabulary-picker">
    <h2 className="section-title">Escolha o que vai para seu vocabulário</h2>
    <p className="row-meta">Nada é salvo automaticamente. Selecione palavras individuais ou um grupo inteiro.</p>
    {groups.map((group) => {
      const items = candidates.filter((item) => item.source === group.source);
      const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
      return <div className="vocabulary-group" key={group.source}>
        <div className="top-row"><h3 className="row-title">{group.title}</h3>
          <button className="text-button" type="button" onClick={() => setSelected((current) => {
            const next = new Set(current); items.forEach((item) => allSelected ? next.delete(item.id) : next.add(item.id)); return next;
          })}>{allSelected ? "Desmarcar todas" : "Selecionar todas"}</button>
        </div>
        <div className="vocabulary-options">
          {items.map((item) => <label className={selected.has(item.id) ? "vocabulary-option selected" : "vocabulary-option"} key={item.id}>
            <input checked={selected.has(item.id)} onChange={() => toggle(item.id)} type="checkbox" />
            <span>{item.text}</span>{selected.has(item.id) ? <Check size={16} /> : null}
          </label>)}
        </div>
      </div>;
    })}
    <button className="green-button full-button" disabled={saving || selected.size === 0} onClick={save} type="button">
      {saving ? <Loader2 className="spin" /> : <BookOpen />} Salvar {selected.size} selecionada(s)
    </button>
    {message ? <p className="row-meta" aria-live="polite">{message}</p> : null}
  </section>;
}
