"use client";

import { useEffect } from "react";

export default function GlobalErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f6f8f6", color: "#1c2b21" }}>
        <main
          role="alert"
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            textAlign: "center"
          }}
        >
          <h1 style={{ margin: 0, fontSize: 22 }}>Não foi possível carregar agora</h1>
          <p style={{ margin: 0, fontSize: 15, color: "#4d5f53" }}>Verifique sua conexão e tente novamente.</p>
          <button
            onClick={reset}
            type="button"
            style={{
              marginTop: 8,
              padding: "12px 20px",
              border: 0,
              borderRadius: 999,
              background: "#217a38",
              color: "#ffffff",
              fontSize: 15,
              fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Tentar novamente
          </button>
        </main>
      </body>
    </html>
  );
}
