"use client";

import { useActionState, useState } from "react";
import { login, requestPasswordReset, signup, type AuthFormState } from "@/app/login/actions";
import { AuthMascot } from "@/components/AuthMascot";

type Mode = "login" | "signup" | "reset";

const initialState: AuthFormState = {};

const heroCopy: Record<Mode, { bubble: string; tagline: string }> = {
  login: { bubble: "Olá de novo!", tagline: "Pronto para conversar hoje?" },
  signup: { bubble: "Bora aprender!", tagline: "Comece sua jornada de fluência." },
  reset: { bubble: "Sem pânico!", tagline: "A gente te ajuda a voltar." }
};

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const action = mode === "login" ? login : mode === "signup" ? signup : requestPasswordReset;
  const [state, formAction, pending] = useActionState(action, initialState);
  const hero = heroCopy[mode];

  return (
    <>
      <header className="auth-hero">
        <AuthMascot bubble={hero.bubble} />
        <h1 className="auth-wordmark">
          Talk<span>kito</span>
        </h1>
        <p className="auth-tagline">{hero.tagline}</p>
      </header>

      <div className="auth-card">
        {mode !== "reset" ? (
          <div className="auth-tabs" role="tablist" aria-label="Entrar ou criar conta">
            <button
              type="button"
              role="tab"
              id="auth-tab-login"
              aria-controls="auth-panel"
              className={`auth-tab${mode === "login" ? " active" : ""}`}
              aria-selected={mode === "login"}
              onClick={() => setMode("login")}
            >
              Entrar
            </button>
            <button
              type="button"
              role="tab"
              id="auth-tab-signup"
              aria-controls="auth-panel"
              className={`auth-tab${mode === "signup" ? " active" : ""}`}
              aria-selected={mode === "signup"}
              onClick={() => setMode("signup")}
            >
              Criar conta
            </button>
          </div>
        ) : (
          <h2 className="auth-card-title">Redefinir senha</h2>
        )}

        <form action={formAction} className="auth-form" id="auth-panel" role="tabpanel" aria-labelledby={mode === "signup" ? "auth-tab-signup" : "auth-tab-login"}>
          {mode === "signup" && (
            <input
              name="name"
              placeholder="Seu nome"
              autoComplete="name"
              aria-label="Seu nome"
              className="auth-input"
            />
          )}
          <input
            name="email"
            type="email"
            required
            placeholder="Email"
            autoComplete="email"
            aria-label="Email"
            className="auth-input"
          />
          {mode !== "reset" && (
            <input
              name="password"
              type="password"
              required
              minLength={8}
              placeholder="Senha"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              aria-label="Senha"
              className="auth-input"
            />
          )}

          {state.error && (
            <p role="alert" className="auth-alert error">
              {state.error}
            </p>
          )}
          {state.success && (
            <p role="status" className="auth-alert success">
              {state.success}
            </p>
          )}

          <button type="submit" disabled={pending} className="green-button full-button auth-submit">
            {pending ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link"}
          </button>
        </form>

        <div className="auth-links">
          {mode === "reset" ? (
            <button type="button" onClick={() => setMode("login")} className="auth-link">
              Voltar para o login
            </button>
          ) : (
            <button type="button" onClick={() => setMode("reset")} className="auth-link">
              Esqueci a senha
            </button>
          )}
        </div>
      </div>
    </>
  );
}
