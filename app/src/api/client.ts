// Typed fetch wrappers for the three Supabase Edge Functions. The user's
// Groq / Anthropic keys travel per-request in headers (x-groq-key /
// x-anthropic-key) — the functions are pass-through proxies and never store
// them. Every call has an abort timeout so a dead network can't hang the HUD.

import type { Suggestion } from "../conversation/thread";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface TranscribeResult {
  text: string;
  language: string;
}

export interface RespondResult {
  translation_en: string;
  suggestions: Suggestion[];
}

export interface ThreadSummary {
  id: string;
  title: string | null;
  locked_language: string | null;
  created_at: string;
}

export interface UtteranceRow {
  id: string;
  created_at: string;
  original_text: string;
  translation_en: string;
  suggestions: Suggestion[];
}

export interface ThreadDetail extends ThreadSummary {
  utterances: UtteranceRow[];
}

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

async function request<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: abort.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message = typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
      throw new ApiError(message, res.status);
    }
    return body as T;
  } finally {
    clearTimeout(timer);
  }
}

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 30_000;

  return {
    async transcribe(
      wav: Uint8Array,
      { groqKey, language }: { groqKey: string; language?: string },
    ): Promise<TranscribeResult> {
      const qs = language ? `?language=${encodeURIComponent(language)}` : "";
      return request<TranscribeResult>(
        `${base}/transcribe${qs}`,
        {
          method: "POST",
          headers: { "content-type": "audio/wav", "x-groq-key": groqKey },
          body: wav.slice().buffer as ArrayBuffer,
        },
        timeoutMs,
      );
    },

    async respond(params: {
      anthropicKey: string;
      threadId: string;
      text: string;
      language: string;
      context: readonly string[];
    }): Promise<RespondResult> {
      return request<RespondResult>(
        `${base}/respond`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-anthropic-key": params.anthropicKey,
          },
          body: JSON.stringify({
            thread_id: params.threadId,
            text: params.text,
            language: params.language,
            context: params.context,
          }),
        },
        timeoutMs,
      );
    },

    async createThread(): Promise<{ id: string }> {
      return request(
        `${base}/threads`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
        timeoutMs,
      );
    },

    async listThreads(): Promise<{ threads: ThreadSummary[] }> {
      return request(`${base}/threads`, { method: "GET" }, timeoutMs);
    },

    async getThread(id: string): Promise<ThreadDetail> {
      return request(
        `${base}/threads?id=${encodeURIComponent(id)}`,
        { method: "GET" },
        timeoutMs,
      );
    },

    async deleteThread(id: string): Promise<void> {
      await request(
        `${base}/threads?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
        timeoutMs,
      );
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
