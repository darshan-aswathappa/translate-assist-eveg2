import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiClient, ApiError } from "./client";

const BASE = "https://example.supabase.co/functions/v1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function lastCall(mock: ReturnType<typeof vi.fn>): { url: string; init: RequestInit } {
  const [url, init] = mock.mock.calls.at(-1)!;
  return { url: String(url), init: init as RequestInit };
}

afterEach(() => vi.unstubAllGlobals());

describe("createApiClient", () => {
  it("transcribe posts WAV bytes with deepgram key and language hint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: "こんにちは", language: "ja" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    const wav = Uint8Array.from([82, 73, 70, 70]);
    const result = await api.transcribe(wav, { deepgramKey: "dg_test", language: "ja" });

    expect(result).toEqual({ text: "こんにちは", language: "ja" });
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/transcribe?language=ja`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-deepgram-key")).toBe("dg_test");
    expect(new Headers(init.headers).get("content-type")).toBe("audio/wav");
  });

  it("transcribe omits the language param when not locked yet", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: "hola", language: "es" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    await api.transcribe(new Uint8Array(4), { deepgramKey: "dg_test" });
    expect(lastCall(fetchMock).url).toBe(`${BASE}/transcribe`);
  });

  it("transcribe forwards keyterms as repeated query params", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: "hi", language: "ja" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    await api.transcribe(new Uint8Array(4), {
      deepgramKey: "dg_test",
      language: "ja",
      keyterms: ["Nestor", "Shibuya Station", " ", "HireFeed"],
    });
    const url = new URL(lastCall(fetchMock).url);
    expect(url.searchParams.get("language")).toBe("ja");
    expect(url.searchParams.getAll("keyterm")).toEqual(["Nestor", "Shibuya Station", "HireFeed"]);
  });

  it("respond posts thread context with anthropic key and parses suggestions", async () => {
    const payload = {
      translation_en: "Do you speak English?",
      suggestions: [{ native: "はい", roman: "hai", gloss: "yes" }],
    };
    const fetchMock = vi.fn(async () => jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    const result = await api.respond({
      anthropicKey: "sk-ant-test",
      threadId: "t-1",
      text: "英語を話せますか",
      language: "ja",
      context: ["前の発言"],
    });

    expect(result.translation_en).toBe("Do you speak English?");
    expect(result.suggestions).toHaveLength(1);
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/respond`);
    expect(new Headers(init.headers).get("x-anthropic-key")).toBe("sk-ant-test");
    expect(JSON.parse(String(init.body))).toMatchObject({ thread_id: "t-1", language: "ja" });
  });

  it("thread lifecycle: create, list, get, delete", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "t-9" }))
      .mockResolvedValueOnce(jsonResponse({ threads: [{ id: "t-9" }] }))
      .mockResolvedValueOnce(jsonResponse({ id: "t-9", utterances: [] }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    expect((await api.createThread()).id).toBe("t-9");
    expect((await api.listThreads()).threads).toHaveLength(1);
    expect((await api.getThread("t-9")).id).toBe("t-9");
    await api.deleteThread("t-9");

    const del = lastCall(fetchMock);
    expect(del.url).toBe(`${BASE}/threads?id=t-9`);
    expect(del.init.method).toBe("DELETE");
  });

  it("throws ApiError with the server message on non-2xx", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "Set your API keys in Settings" }, 401));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    await expect(api.transcribe(new Uint8Array(4), { deepgramKey: "" })).rejects.toThrow(
      "Set your API keys in Settings",
    );
    await expect(
      api.transcribe(new Uint8Array(4), { deepgramKey: "" }),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it("respond forwards mode and utterance_id when given", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ translation_en: "", suggestions: [], utterance_id: "u-1" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    await api.respond({
      anthropicKey: "sk-ant-test",
      threadId: "t-1",
      text: "こんにちは",
      language: "ja",
      context: [],
      mode: "suggest",
      utteranceId: "u-1",
    });
    expect(JSON.parse(String(lastCall(fetchMock).init.body))).toMatchObject({
      mode: "suggest",
      utterance_id: "u-1",
    });
  });

  it("respond omits mode/utterance_id by default (full mode)", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ translation_en: "hi", suggestions: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    await api.respond({
      anthropicKey: "sk-ant-test",
      threadId: "t-1",
      text: "こんにちは",
      language: "ja",
      context: [],
    });
    const body = JSON.parse(String(lastCall(fetchMock).init.body));
    expect("mode" in body).toBe(false);
    expect("utterance_id" in body).toBe(false);
  });

  describe("retries", () => {
    it("retries network failures and succeeds", async () => {
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new TypeError("Failed to fetch"))
        .mockResolvedValueOnce(jsonResponse({ text: "hola", language: "es" }));
      vi.stubGlobal("fetch", fetchMock);
      const api = createApiClient({ baseUrl: BASE, retries: 2, retryDelayMs: 1 });

      const result = await api.transcribe(new Uint8Array(4), { deepgramKey: "dg" });
      expect(result.text).toBe("hola");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("retries 5xx responses", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ error: "Translation failed (529)" }, 502))
        .mockResolvedValueOnce(jsonResponse({ translation_en: "hi", suggestions: [] }));
      vi.stubGlobal("fetch", fetchMock);
      const api = createApiClient({ baseUrl: BASE, retries: 2, retryDelayMs: 1 });

      const result = await api.respond({
        anthropicKey: "sk-ant-test",
        threadId: "t-1",
        text: "hola",
        language: "es",
        context: [],
      });
      expect(result.translation_en).toBe("hi");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry 4xx responses", async () => {
      const fetchMock = vi.fn(async () => jsonResponse({ error: "bad key" }, 401));
      vi.stubGlobal("fetch", fetchMock);
      const api = createApiClient({ baseUrl: BASE, retries: 2, retryDelayMs: 1 });

      await expect(api.transcribe(new Uint8Array(4), { deepgramKey: "x" })).rejects.toThrow(
        "bad key",
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("gives up after the configured retries", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
      vi.stubGlobal("fetch", fetchMock);
      const api = createApiClient({ baseUrl: BASE, retries: 2, retryDelayMs: 1 });

      await expect(api.transcribe(new Uint8Array(4), { deepgramKey: "x" })).rejects.toThrow();
      expect(fetchMock).toHaveBeenCalledTimes(3); // first try + 2 retries
    });
  });
});
