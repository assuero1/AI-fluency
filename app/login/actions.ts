"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getRequestSupabaseClient } from "@/lib/supabase/server";
import { getEnv } from "@/lib/env";

export type AuthFormState = { error?: string; success?: string };

const GENERIC_ERROR = "Email ou senha inválidos.";

// APP_URL tem prioridade; sem ela, deriva a origin da request para não gerar
// links relativos silenciosos nos emails de confirmação/reset.
async function getAuthEmailOrigin(): Promise<string> {
  const appUrl = getEnv("APP_URL");
  if (appUrl) return appUrl.replace(/\/+$/, "");
  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin) return origin.replace(/\/+$/, "");
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (!host) return "";
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function login(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Informe email e senha." };

  const supabase = await getRequestSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: GENERIC_ERROR };
  redirect("/");
}

export async function signup(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!email || !password) return { error: "Informe email e senha." };
  if (password.length < 8) return { error: "A senha precisa de pelo menos 8 caracteres." };

  const supabase = await getRequestSupabaseClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { name }, emailRedirectTo: `${await getAuthEmailOrigin()}/auth/callback` }
  });
  if (error) return { error: "Não foi possível criar a conta. Tente outro email." };
  return { success: "Conta criada! Confira seu email para confirmar o cadastro." };
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Informe seu email." };

  const supabase = await getRequestSupabaseClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${await getAuthEmailOrigin()}/auth/callback?next=/reset-password`
  });
  // Mensagem idêntica para emails existentes ou não (não vazar existência).
  return { success: "Se o email estiver cadastrado, você receberá o link de redefinição." };
}

export async function updatePassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "A senha precisa de pelo menos 8 caracteres." };

  const supabase = await getRequestSupabaseClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: "Não foi possível atualizar a senha. Abra o link do email novamente." };
  redirect("/");
}

export async function logout() {
  const supabase = await getRequestSupabaseClient();
  // Escopo local: encerra só esta sessão/dispositivo. O default ("global")
  // revoga TODAS as sessões do usuário — inclusive outras sessões legítimas
  // (ex.: outro dispositivo, ou a sessão compartilhada do harness e2e).
  await supabase.auth.signOut({ scope: "local" });
  redirect("/login");
}
