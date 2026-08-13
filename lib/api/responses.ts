import { NextResponse } from "next/server";
import { AiConfigError, AiRequestError } from "@/lib/ai/client";
import { KokoroConfigError, KokoroRequestError } from "@/lib/kokoro/client";
import { AccountValidationError } from "@/lib/learning/account";
import { LearningStateError } from "@/lib/learning/access";
import { TranslationValidationError } from "@/lib/learning/translation";
import { UnauthenticatedError, UserLinkError } from "@/lib/learning/profile";
import { TeableConfigError, TeableRequestError } from "@/lib/teable/client";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 500, detail?: unknown) {
  return NextResponse.json({ ok: false, error: message, detail }, { status });
}

const NETWORK_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ECONNRESET", "EHOSTUNREACH", "EAI_AGAIN"]);

function classifyUpstreamError(error: Error): "timeout" | "network" | null {
  let current: unknown = error;
  while (current instanceof Error) {
    const code = (current as { code?: unknown }).code;
    if (current.name === "AbortError" || current.name === "TimeoutError" || /timed out/i.test(current.message) || code === "ETIMEDOUT") {
      return "timeout";
    }
    if ((current instanceof TypeError && /fetch failed/i.test(current.message)) || (typeof code === "string" && NETWORK_ERROR_CODES.has(code))) {
      return "network";
    }
    current = current.cause;
  }
  return null;
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

  if (error instanceof UnauthenticatedError) {
    return jsonError(error.message, 401);
  }

  if (error instanceof UserLinkError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof TeableConfigError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof TeableRequestError) {
    console.error(JSON.stringify({ event: "teable_request_failed", status: error.status, timestamp: new Date().toISOString() }));
    return jsonError(error.message, error.status, process.env.NODE_ENV === "production" ? undefined : error.detail);
  }

  if (error instanceof AiConfigError || error instanceof KokoroConfigError) {
    return jsonError(error.message, error.status);
  }

  if (error instanceof AiRequestError || error instanceof KokoroRequestError) {
    console.error(JSON.stringify({ event: error instanceof AiRequestError ? "ai_request_failed" : "kokoro_request_failed", status: error.status, timestamp: new Date().toISOString() }));
    return jsonError(error.message, error.status);
  }

  if (error instanceof Error) {
    const classification = classifyUpstreamError(error);
    if (classification === "timeout") {
      console.error(JSON.stringify({ event: "upstream_timeout", message: error.message, timestamp: new Date().toISOString() }));
      return jsonError("Upstream request timed out.", 504);
    }
    if (classification === "network") {
      console.error(JSON.stringify({ event: "upstream_network_failed", message: error.message, timestamp: new Date().toISOString() }));
      return jsonError("Upstream service unreachable.", 502);
    }
    console.error(JSON.stringify({ event: "api_unhandled_error", message: error.message, timestamp: new Date().toISOString() }));
    return jsonError(process.env.NODE_ENV === "production" ? "Unexpected server error." : error.message);
  }

  return jsonError("Unknown server error.");
}
