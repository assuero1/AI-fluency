"use client";

import { useActionState } from "react";
import { updatePassword, type AuthFormState } from "@/app/login/actions";
import { AuthMascot } from "@/components/AuthMascot";
import { LoadingScene } from "@/components/LoadingScene";

const initialState: AuthFormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <>
      <header className="auth-hero">
        <AuthMascot bubble="Quase lá!" />
        <h1 className="auth-wordmark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="auth-wordmark-img" src="/logo-talkito.png" alt="Talkito" width={900} height={230} loading="eager" />
        </h1>
        <p className="auth-tagline">Escolha uma nova senha para continuar.</p>
      </header>

      <div className="auth-card">
        <h2 className="auth-card-title">Nova senha</h2>
        <form action={formAction} className="auth-form">
          <input
            name="password"
            type="password"
            required
            minLength={8}
            placeholder="Nova senha"
            autoComplete="new-password"
            aria-label="Nova senha"
            className="auth-input"
          />
          {state.error && (
            <p role="alert" className="auth-alert error">
              {state.error}
            </p>
          )}
          <button type="submit" disabled={pending} className="green-button full-button auth-submit">
            {pending ? "Aguarde..." : "Salvar nova senha"}
          </button>
          {pending ? <LoadingScene variant="overlay" moment="save" palette="neutral" title="Salvando nova senha..." /> : null}
        </form>
      </div>
    </>
  );
}
