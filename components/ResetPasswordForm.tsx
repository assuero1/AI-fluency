"use client";

import { useActionState } from "react";
import { updatePassword, type AuthFormState } from "@/app/login/actions";

const initialState: AuthFormState = {};

export function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(updatePassword, initialState);

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="mb-4 text-xl font-semibold text-slate-900">Nova senha</h1>
      <form action={formAction} className="flex flex-col gap-3">
        <input name="password" type="password" required minLength={8} placeholder="Nova senha" autoComplete="new-password" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        {state.error && <p role="alert" className="text-sm text-red-600">{state.error}</p>}
        <button type="submit" disabled={pending} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
          {pending ? "Aguarde..." : "Salvar nova senha"}
        </button>
      </form>
    </div>
  );
}
