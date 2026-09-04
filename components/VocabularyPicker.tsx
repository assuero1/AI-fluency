"use client";

import { BookOpen, Check } from "lucide-react";
import { plura } from "@/lib/plural";
import { SpiralSpinner } from "./SpiralSpinner";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { VocabularyCandidateGroup } from "@/lib/learning/vocabulary-selection";
import { getVocabularyGroupBadge, getVocabularyGroupSubtitle } from "@/lib/learning/vocabulary-picker-ui";
import { Pill } from "./Pill";

export function VocabularyPicker({ conversationId }: {
  conversationId: string;
}) {
  const router = useRouter();
  const [candidateGroups, setCandidateGroups] = useState<VocabularyCandidateGroup[] | null>(null);
  const groupsById = useMemo(() => new Map((candidateGroups ?? []).map((group) => [group.id, group])), [candidateGroups]);
  const [selected, setSelected] = useState(() => new Set<string>());
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadGroups() {
      try {
        const response = await fetch(`/api/conversations/${conversationId}/vocabulary/candidates`, { cache: "no-store" });
        const data = await response.json() as { ok?: boolean; error?: string; groups?: VocabularyCandidateGroup[] };
        if (!response.ok || !data.ok || !data.groups) throw new Error(data.error ?? "Não foi possível analisar as palavras.");
        if (!cancelled) setCandidateGroups(data.groups);
      } catch (error) {
        if (!cancelled) {
          setCandidateGroups([]);
          setMessage(error instanceof Error ? error.message : "Não foi possível analisar as palavras.");
        }
      }
    }
    void loadGroups();
    return () => { cancelled = true; };
  }, [conversationId]);

  function toggle(id: string) {
    if (!groupsById.get(id)?.eligible) return;
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
        body: JSON.stringify({ candidateIds: [...selected].flatMap((id) => groupsById.get(id)?.candidateIds ?? []) })
      });
      const data = await response.json() as { ok?: boolean; error?: string; savedCount?: number; newWordCount?: number; updatedWordCount?: number; rejectedCount?: number };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Não foi possível salvar as palavras.");
      setMessage(formatVocabularySaveResult(data));
      setCandidateGroups((current) => current?.filter((group) => !selected.has(group.id)) ?? []);
      setSelected(new Set());
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Não foi possível salvar as palavras.");
    } finally { setSaving(false); }
  }

  return <section className="section vocabulary-picker">
    <h2 className="section-title">Escolha o que vai para seu vocabulário</h2>
    <p className="row-meta">Aqui aparecem apenas palavras que ainda não estão no seu vocabulário. Nada é salvo automaticamente.</p>
    {candidateGroups === null ? (
      <div className="empty-state">
        <SpiralSpinner label="Analisando formas relacionadas..." size={24} />
        <p className="row-meta">Analisando formas relacionadas...</p>
      </div>
    ) : null}
    {candidateGroups?.length === 0 && !message ? <div className="empty-state">Nenhuma palavra nova disponível nesta conversa.</div> : null}
    {(() => {
      const items = candidateGroups ?? [];
      if (candidateGroups === null || items.length === 0) return null;
      const eligibleItems = items.filter((item) => item.eligible);
      const allSelected = eligibleItems.length > 0 && eligibleItems.every((item) => selected.has(item.id));
      return <div className="vocabulary-group">
        <div className="top-row"><h3 className="row-title">Palavras que você usou</h3>
          <button className="text-button" type="button" onClick={() => setSelected((current) => {
            const next = new Set(current); eligibleItems.forEach((item) => allSelected ? next.delete(item.id) : next.add(item.id)); return next;
          })}>{allSelected ? "Desmarcar todas" : "Selecionar todas"}</button>
        </div>
        <div className="vocabulary-options">
          {items.map((item) => <label className={selected.has(item.id) ? "vocabulary-option selected" : "vocabulary-option"} key={item.id}>
            <input checked={selected.has(item.id)} disabled={!item.eligible} onChange={() => toggle(item.id)} type="checkbox" />
            <span>
              {item.displayText}{item.occurrenceCount > 1 ? ` (${item.occurrenceCount}×)` : ""}
              {getVocabularyGroupBadge(item) ? <>{" "}<Pill tone="info">{getVocabularyGroupBadge(item)}</Pill></> : null}
              <small>{formatRelatedForms(item)}{getCandidateStatus(item)}</small>
              {getVocabularyGroupSubtitle(item) ? <small>{getVocabularyGroupSubtitle(item)}</small> : null}
            </span>{selected.has(item.id) ? <Check size={16} /> : null}
          </label>)}
        </div>
      </div>;
    })()}
    <button className="green-button full-button" disabled={candidateGroups === null || saving || selected.size === 0} onClick={save} type="button">
      {saving ? <SpiralSpinner label="Salvando palavras..." size={20} /> : <BookOpen />}
      {saving ? "Salvando palavras..." : `Salvar ${plura(selected.size, "selecionada", "selecionadas")}`}
    </button>
    {message ? <p className="row-meta" aria-live="polite">{message}</p> : null}
  </section>;
}

function formatRelatedForms(group: VocabularyCandidateGroup) {
  const distinctForms = group.forms.filter((form) => form.toLocaleLowerCase() !== group.lemma);
  return distinctForms.length ? `Formas: ${distinctForms.join(", ")} · ` : "";
}

function getCandidateStatus(candidate: VocabularyCandidateGroup) {
  if (!candidate.eligible) return "Uso corrigido — não será salvo";
  if (candidate.incorrectOccurrenceCount > 0) return `${plura(candidate.correctOccurrenceCount, "uso correto", "usos corretos")}; usos corrigidos ignorados`;
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
    result.newWordCount ? plura(result.newWordCount, "nova", "novas") : "",
    result.updatedWordCount ? plura(result.updatedWordCount, "atualizada", "atualizadas") : "",
    plura(saved, "uso registrado", "usos registrados"),
    result.rejectedCount ? `${plura(result.rejectedCount, "uso corrigido ignorado", "usos corrigidos ignorados")}` : ""
  ].filter(Boolean);
  return parts.join(" · ");
}
