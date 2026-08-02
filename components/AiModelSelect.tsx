"use client";

import { useEffect, useState } from "react";

type LoadState = "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "success" | "error";

export function AiModelSelect({
  currentModel,
  modelSource,
  aiConfigured
}: {
  currentModel: string | null;
  modelSource: "teable" | "env";
  aiConfigured: boolean;
}) {
  const [loadState, setLoadState] = useState<LoadState>(aiConfigured ? "loading" : "error");
  const [models, setModels] = useState<string[]>(currentModel ? [currentModel] : []);
  const [source, setSource] = useState<"provider" | "fallback">("provider");
  const [selected, setSelected] = useState(currentModel ?? "");
  const [saved, setSaved] = useState(currentModel ?? "");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!aiConfigured) return;
    let cancelled = false;

    fetch("/api/settings/ai/models", { cache: "no-store" })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          | { models?: string[]; source?: "provider" | "fallback" }
          | null;
        if (!response.ok || !data?.models) throw new Error("models load failed");
        if (cancelled) return;
        const list = currentModel && !data.models.includes(currentModel) ? [currentModel, ...data.models] : data.models;
        setModels(list);
        setSource(data.source ?? "provider");
        setLoadState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setLoadState("error");
      });

    return () => {
      cancelled = true;
    };
  }, [aiConfigured, currentModel]);

  async function save() {
    setSaveState("saving");
    setMessage("");

    try {
      const response = await fetch("/api/settings/ai/model", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatModel: selected })
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setSaveState("error");
        setMessage(data?.error ?? "Não foi possível salvar o modelo.");
        return;
      }

      setSaved(selected);
      setSaveState("success");
      setMessage("Modelo atualizado.");
    } catch {
      setSaveState("error");
      setMessage("Não foi possível salvar o modelo. Tente novamente.");
    }
  }

  if (!aiConfigured) {
    return <div className="row-meta">Configure a IA no servidor primeiro.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <label className="muted" htmlFor="ai-model-select">
        Trocar modelo{modelSource === "teable" ? " (personalizado)" : ""}
      </label>
      <select
        aria-label="Modelo de IA"
        className="outline-button full-button"
        disabled={loadState !== "ready" || saveState === "saving"}
        id="ai-model-select"
        onChange={(event) => {
          setSelected(event.target.value);
          setSaveState("idle");
          setMessage("");
        }}
        value={selected}
      >
        {loadState === "loading" ? <option value="">Carregando modelos...</option> : null}
        {models.map((model) => (
          <option key={model} value={model}>
            {model}
          </option>
        ))}
      </select>
      {loadState === "ready" && source === "fallback" ? (
        <div className="row-meta">Lista estimada — não foi possível consultar o provedor.</div>
      ) : null}
      {loadState === "error" ? <div className="row-meta">Não foi possível carregar a lista de modelos.</div> : null}
      <button
        aria-busy={saveState === "saving"}
        className="dark-button full-button"
        disabled={saveState === "saving" || !selected || selected === saved}
        onClick={save}
        type="button"
      >
        {saveState === "saving" ? "Salvando..." : "Salvar modelo"}
      </button>
      {message ? (
        <div
          aria-live="polite"
          className={saveState === "error" ? "row-meta" : "metric-foot"}
          role={saveState === "error" ? "alert" : "status"}
          style={{ marginTop: 8 }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}
