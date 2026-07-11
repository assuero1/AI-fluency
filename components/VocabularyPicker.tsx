"use client";

import { BookOpen, Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { VocabularyCandidate } from "@/lib/learning/vocabulary-selection";

export function VocabularyPicker({ conversationId, candidates, existingWords, savedIds }: {
  conversationId: string;
  candidates: VocabularyCandidate[];
  existingWords: string[];
  savedIds: string[];
}) {
  const router = useRouter();
  const candidatesById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);
  const savedIdSet = useMemo(() => new Set(savedIds), [savedIds]);
  const existingWordSet = useMemo(() => new Set(existingWords), [existingWords]);
  const [selected, setSelected] = useState(() => new Set(savedIds.filter((id) => candidatesById.get(id)?.eligible)));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const groups = [
    { source: "user" as const, title: "Palavras que você usou" },
    { source: "assistant" as const, title: "Palavras usadas pela IA" }
  ];

  function toggle(id: string) {
    if (!candidatesById.get(id)?.eligible) return;
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
      const data = await response.json() as { ok?: boolean; error?: string; savedCount?: number; newWordCount?: number; updatedWordCount?: number; rejectedCount?: number };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível salvar as palavras.");
      setMessage(formatVocabularySaveResult(data));
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
      const eligibleItems = items.filter((item) => item.eligible);
      const allSelected = eligibleItems.length > 0 && eligibleItems.every((item) => selected.has(item.id));
      return <div className="vocabulary-group" key={group.source}>
        <div className="top-row"><h3 className="row-title">{group.title}</h3>
          <button className="text-button" type="button" onClick={() => setSelected((current) => {
            const next = new Set(current); eligibleItems.forEach((item) => allSelected ? next.delete(item.id) : next.add(item.id)); return next;
          })}>{allSelected ? "Desmarcar todas" : "Selecionar todas"}</button>
        </div>
        <div className="vocabulary-options">
          {items.map((item) => <label className={selected.has(item.id) ? "vocabulary-option selected" : "vocabulary-option"} key={item.id}>
            <input checked={selected.has(item.id)} disabled={!item.eligible} onChange={() => toggle(item.id)} type="checkbox" />
            <span>{item.text}{item.occurrenceCount > 1 ? ` (${item.occurrenceCount}×)` : ""}<small>{getCandidateStatus(item, savedIdSet.has(item.id), existingWordSet.has(item.normalized))}</small></span>{selected.has(item.id) ? <Check size={16} /> : null}
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

function getCandidateStatus(candidate: VocabularyCandidate, alreadySaved: boolean, alreadyInVocabulary: boolean) {
  if (!candidate.eligible) return "Uso corrigido — não será salvo";
  if (candidate.incorrectOccurrenceCount > 0) return `${candidate.correctOccurrenceCount} uso(s) correto(s); usos corrigidos ignorados`;
  if (alreadySaved) return "Já registrado nesta conversa";
  if (alreadyInVocabulary) return "Já está no vocabulário — o uso será atualizado";
  if (candidate.source === "assistant") return "Sugestão usada pela IA — não conta como domínio";
  return "Novo uso do seu vocabulário";
}

export function formatVocabularySaveResult(result: {
  savedCount?: number;
  newWordCount?: number;
  updatedWordCount?: number;
  rejectedCount?: number;
}) {
  const saved = result.savedCount ?? 0;
  if (saved === 0) return result.rejectedCount ? "Nenhum uso correto foi salvo; os usos corrigidos foram ignorados." : "Nenhuma alteração necessária.";
  const parts = [
    result.newWordCount ? `${result.newWordCount} nova(s)` : "",
    result.updatedWordCount ? `${result.updatedWordCount} atualizada(s)` : "",
    `${saved} uso(s) registrado(s)`,
    result.rejectedCount ? `${result.rejectedCount} uso(s) corrigido(s) ignorado(s)` : ""
  ].filter(Boolean);
  return parts.join(" · ");
}
