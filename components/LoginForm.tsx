"use client";

import { useActionState, useState } from "react";
import { login, requestPasswordReset, signup, type AuthFormState } from "@/app/login/actions";

type Mode = "login" | "signup" | "reset";

const initialState: AuthFormState = {};

export function LoginForm() {
  const [mode, setMode] = useState<Mode>("login");
  const action = mode === "login" ? login : mode === "signup" ? signup : requestPasswordReset;
  const [state, formAction, pending] = useActionState(action, initialState);

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-1 text-xl font-semibold text-slate-900">AI Fluency</h1>
      <p className="mb-4 text-sm text-slate-500">
        {mode === "login" ? "Entre na sua conta" : mode === "signup" ? "Crie sua conta" : "Redefinir senha"}
      </p>

      <form action={formAction} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input name="name" placeholder="Seu nome" autoComplete="name" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        )}
        <input name="email" type="email" required placeholder="Email" autoComplete="email" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {mode !== "reset" && (
          <input name="password" type="password" required minLength={8} placeholder="Senha" autoComplete={mode === "login" ? "current-password" : "new-password"} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        )}

        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        {state.success && <p role="status" className="text-sm text-emerald-600">{state.success}</p>}

        <button type="submit" disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Aguarde..." : mode === "login" ? "Entrar" : mode === "signup" ? "Criar conta" : "Enviar link"}
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-1 text-sm">
        {mode !== "login" && (
          <button type="button" onClick={() => setMode("login")} className="text-left text-slate-600 underline">Já tenho conta — entrar</button>
        )}
        {mode !== "signup" && (
          <button type="button" onClick={() => setMode("signup")} className="text-left text-slate-600 underline">Criar conta</button>
        )}
        {mode !== "reset" && (
          <button type="button" onClick={() => setMode("reset")} className="text-left text-slate-600 underline">Esqueci a senha</button>
        )}
      </div>
    </div>
  );
}
