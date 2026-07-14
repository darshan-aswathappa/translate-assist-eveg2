// Typed fetch wrappers for the Supabase Edge Functions. Two auth modes travel
// per-request in headers: free tier sends the user's own keys (x-deepgram-key /
// x-anthropic-key — pass-through, never stored), Pro sends the device token
// from a redeemed license (x-device-token — the server uses its own provider
// keys). Every call has an abort timeout so a dead network can't hang the HUD,
// and transient failures (network drop, 5xx) are retried with backoff.

import type { Suggestion } from "../conversation/thread";

/** Free tier carries the user's provider key; Pro carries the device token. */
export type TranscribeAuth = { deepgramKey: string } | { deviceToken: string };
export type RespondAuth = { anthropicKey: string } | { deviceToken: string };

function authHeader(
  auth: TranscribeAuth | RespondAuth,
  keyHeader: string,
): Record<string, string> {
  if ("deviceToken" in auth) return { "x-device-token": auth.deviceToken };
  return { [keyHeader]: "deepgramKey" in auth ? auth.deepgramKey : auth.anthropicKey };
}

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

/** What the wearer needs from a turn. `translate` mode returns an empty
 * suggestions array plus the persisted utterance id, so a follow-up `suggest`
 * call can attach suggestions to the same row. */
export type RespondMode = "full" | "translate" | "suggest";

export interface RespondResult {
  translation_en: string;
  suggestions: Suggestion[];
  utterance_id?: string | null;
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

export interface UsageTotals {
  audio_seconds: number;
  claude_turns: number;
}

export interface LicenseStatus {
  plan: "monthly" | "yearly";
  status: "active" | "past_due" | "canceled";
  activated_at: string | null;
  usage: UsageTotals;
  caps: UsageTotals;
}

export interface ApiClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  /** Tighter timeout for transcription (a single short request); defaults to
   * `timeoutMs` when not given. */
  transcribeTimeoutMs?: number;
  /** Extra attempts after the first for transient failures (network errors and
   * 5xx). Respond retries can, at worst, persist a rare duplicate turn row —
   * an accepted trade-off for not dropping utterances. */
  retries?: number;
  /** Base backoff between retries (grows linearly, with jitter). */
  retryDelayMs?: number;
}

function isRetryable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status >= 500;
  // fetch network failure ("Failed to fetch" / "Load failed") — not an abort.
  return err instanceof TypeError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOnce<T>(
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

async function request<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  retries: number,
  retryDelayMs: number,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await requestOnce<T>(url, init, timeoutMs);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      await sleep(retryDelayMs * (attempt + 1) + Math.random() * retryDelayMs);
    }
  }
}

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/$/, "");
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const transcribeTimeoutMs = opts.transcribeTimeoutMs ?? timeoutMs;
  const retries = opts.retries ?? 0;
  const retryDelayMs = opts.retryDelayMs ?? 400;

  function call<T>(url: string, init: RequestInit, timeout = timeoutMs): Promise<T> {
    return request<T>(url, init, timeout, retries, retryDelayMs);
  }

  return {
    async transcribe(
      wav: Uint8Array,
      {
        auth,
        language,
        keyterms,
      }: { auth: TranscribeAuth; language?: string; keyterms?: readonly string[] },
    ): Promise<TranscribeResult> {
      const params = new URLSearchParams();
      if (language) params.set("language", language);
      for (const term of keyterms ?? []) {
        const trimmed = term.trim();
        if (trimmed) params.append("keyterm", trimmed);
      }
      const qs = params.toString() ? `?${params}` : "";
      return call<TranscribeResult>(
        `${base}/transcribe${qs}`,
        {
          method: "POST",
          headers: { "content-type": "audio/wav", ...authHeader(auth, "x-deepgram-key") },
          // A Blob (not a bare ArrayBuffer) — the iOS/WebKit WebView the glasses
          // app runs in fails a fetch with an ArrayBuffer body ("Load failed",
          // the POST never leaves the device), while a Blob uploads reliably.
          body: new Blob([wav.slice()], { type: "audio/wav" }),
        },
        transcribeTimeoutMs,
      );
    },

    async respond(params: {
      auth: RespondAuth;
      threadId: string;
      text: string;
      language: string;
      context: readonly string[];
      mode?: RespondMode;
      utteranceId?: string;
    }): Promise<RespondResult> {
      return call<RespondResult>(`${base}/respond`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...authHeader(params.auth, "x-anthropic-key"),
        },
        body: JSON.stringify({
          thread_id: params.threadId,
          text: params.text,
          language: params.language,
          context: params.context,
          ...(params.mode ? { mode: params.mode } : {}),
          ...(params.utteranceId ? { utterance_id: params.utteranceId } : {}),
        }),
      });
    },

    async createThread(): Promise<{ id: string }> {
      return call(`${base}/threads`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
    },

    async listThreads(): Promise<{ threads: ThreadSummary[] }> {
      return call(`${base}/threads`, { method: "GET" });
    },

    async getThread(id: string): Promise<ThreadDetail> {
      return call(`${base}/threads?id=${encodeURIComponent(id)}`, { method: "GET" });
    },

    async deleteThread(id: string): Promise<void> {
      await call(`${base}/threads?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    },

    /** Redeem a Pro license key (one-time) for this device's token. */
    async activateLicense(
      licenseKey: string,
    ): Promise<{ device_token: string; plan: "monthly" | "yearly" }> {
      return call(`${base}/license`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "activate", license_key: licenseKey }),
      });
    },

    async licenseStatus(deviceToken: string): Promise<LicenseStatus> {
      return call(`${base}/license`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "status", device_token: deviceToken }),
      });
    },

    /** Report live-streamed audio seconds (the WebSocket bypasses our proxy,
     * so streaming usage is client-metered). */
    async reportUsage(deviceToken: string, audioSeconds: number): Promise<void> {
      await call(`${base}/license`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "report",
          device_token: deviceToken,
          audio_seconds: audioSeconds,
        }),
      });
    },

    /** Mint a short-lived Deepgram token for one Pro live-streaming connect. */
    async mintDgToken(
      deviceToken: string,
    ): Promise<{ access_token: string; expires_in: number }> {
      return call(`${base}/dg-token`, {
        method: "POST",
        headers: { "x-device-token": deviceToken },
      });
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
