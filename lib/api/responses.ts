import { NextResponse } from "next/server";
import { AiConfigError, AiRequestError } from "@/lib/ai/client";
import { KokoroConfigError, KokoroRequestError } from "@/lib/kokoro/client";
import { AccountValidationError } from "@/lib/learning/account";
import { LearningStateError } from "@/lib/learning/access";
import { TranslationValidationError } from "@/lib/learning/translation";
import { PersonalUserResolutionError } from "@/lib/learning/profile";
import { TeableConfigError, TeableRequestError } from "@/lib/teable/client";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 500, detail?: unknown) {
  return NextResponse.json({ ok: false, error: message, detail }, { status });
}

export function handleApiError(error: unknown) {
  if (error instanceof AccountValidationError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof LearningStateError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof TranslationValidationError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof PersonalUserResolutionError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof TeableConfigError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof TeableRequestError) {
    console.error(JSON.stringify({ event: "teable_request_failed", status: error.status, timestamp: new Date().toISOString() }));
    return jsonError(error.message, error.status, error.detail);
  }

  if (error instanceof AiConfigError || error instanceof KokoroConfigError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof AiRequestError || error instanceof KokoroRequestError) {
    console.error(JSON.stringify({ event: error instanceof AiRequestError ? "ai_request_failed" : "kokoro_request_failed", status: error.status, timestamp: new Date().toISOString() }));
    return jsonError(error.message, error.status);
  }

  if (error instanceof Error) {
    return jsonError(error.message);
  }

  return jsonError("Unknown server error.");
}
