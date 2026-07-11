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
  it("transcribe posts WAV bytes with groq key and language hint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: "こんにちは", language: "ja" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    const wav = Uint8Array.from([82, 73, 70, 70]);
    const result = await api.transcribe(wav, { groqKey: "gsk_test", language: "ja" });

    expect(result).toEqual({ text: "こんにちは", language: "ja" });
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe(`${BASE}/transcribe?language=ja`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("x-groq-key")).toBe("gsk_test");
    expect(new Headers(init.headers).get("content-type")).toBe("audio/wav");
  });

  it("transcribe omits the language param when not locked yet", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ text: "hola", language: "es" }));
    vi.stubGlobal("fetch", fetchMock);
    const api = createApiClient({ baseUrl: BASE });

    await api.transcribe(new Uint8Array(4), { groqKey: "gsk_test" });
    expect(lastCall(fetchMock).url).toBe(`${BASE}/transcribe`);
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

    await expect(api.transcribe(new Uint8Array(4), { groqKey: "" })).rejects.toThrow(
      "Set your API keys in Settings",
    );
    await expect(
      api.transcribe(new Uint8Array(4), { groqKey: "" }),
    ).rejects.toBeInstanceOf(ApiError);
  });
});
