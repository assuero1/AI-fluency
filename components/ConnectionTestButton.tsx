"use client";

import { useState } from "react";

type TestState = "idle" | "testing" | "success" | "error";

export function ConnectionTestButton({ endpoint, label }: { endpoint: string; label: string }) {
  const [state, setState] = useState<TestState>("idle");
  const [message, setMessage] = useState<string>("");

  async function runTest() {
    setState("testing");
    setMessage("");

    try {
      const response = await fetch(endpoint, {
        method: "POST"
      });
      const data = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setState("error");
        setMessage(data?.error ?? "Falha no teste.");
        return;
      }

      setState("success");
      setMessage("Conexão validada.");
    } catch {
      setState("error");
      setMessage("Não foi possível executar o teste.");
    }
  }

  return (
    <div>
      <button aria-busy={state === "testing"} aria-label={`Testar conexão: ${label}`} className="outline-button full-button" disabled={state === "testing"} onClick={runTest} type="button">
        {state === "testing" ? "Testando..." : "Testar conexão"}
      </button>
      {message ? (
        <div aria-live="polite" className={state === "error" ? "row-meta" : "metric-foot"} role={state === "error" ? "alert" : "status"} style={{ marginTop: 8 }}>
          {message}
        </div>
      ) : null}
    </div>
  );
}
