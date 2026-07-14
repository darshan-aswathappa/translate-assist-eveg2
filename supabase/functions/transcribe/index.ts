// POST /transcribe[?language=xx] — body: audio/wav bytes.
// Pass-through proxy to Deepgram's pre-recorded API (nova-3). Two auth modes:
// free tier sends the user's own key in x-deepgram-key (forwarded, never
// stored); Pro sends x-device-token, which resolves to an active license and
// uses the server's DEEPGRAM_API_KEY, with the audio length metered against
// the monthly fair-use cap.
// Returns { text, language } where language is an ISO-639-1 code suitable for
// the thread language lock. Deepgram already reports ISO-639-1 codes, so no
// name→code mapping is needed. When a locked language is passed it is sent as a
// hint; otherwise detect_language=true lets Deepgram pick and report one.
// Optional repeated `keyterm` params (domain terms) are forwarded to bias
// recognition (nova-3 keyterm prompting).

import { errorJson, json, preflight } from "../_shared/cors.ts";
import { meterUsage, resolveProAuth } from "../_shared/license.ts";

const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen";
const MODEL = "nova-3";
// Below the app's 20s transcribe timeout, so a hung Deepgram request fails
// here with a clear message instead of burning the client's abort window.
const UPSTREAM_TIMEOUT_MS = 15_000;

interface DeepgramAlternative {
  transcript?: string;
}

interface DeepgramChannel {
  alternatives?: DeepgramAlternative[];
  detected_language?: string;
}

interface DeepgramResponse {
  results?: { channels?: DeepgramChannel[] };
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  // Pro (device token) resolves to the server's key; free forwards the user's.
  let deepgramKey = req.headers.get("x-deepgram-key") ?? "";
  let proLicenseId: string | null = null;
  if (req.headers.get("x-device-token")) {
    const auth = await resolveProAuth(req, { audioCap: true });
    if (auth instanceof Response) return auth;
    proLicenseId = auth.license.id;
    deepgramKey = Deno.env.get("DEEPGRAM_API_KEY") ?? "";
  }
  if (!deepgramKey) return errorJson("Set your API keys in Settings", 401);

  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.length < 100) return errorJson("Empty audio", 400);

  const reqUrl = new URL(req.url);
  const language = reqUrl.searchParams.get("language") ?? "";

  const params = new URLSearchParams({ model: MODEL, smart_format: "true" });
  if (language) params.set("language", language);
  else params.set("detect_language", "true");
  // Keyterm prompting (nova-3): repeated `keyterm` params, forwarded as-is.
  for (const term of reqUrl.searchParams.getAll("keyterm")) {
    const trimmed = term.trim();
    if (trimmed) params.append("keyterm", trimmed);
  }

  let res: Response;
  try {
    res = await fetch(`${DEEPGRAM_URL}?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${deepgramKey}`,
        "content-type": "audio/wav",
      },
      body: audio.slice().buffer,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("deepgram fetch failed", err instanceof Error ? err.message : String(err));
    return errorJson("Transcription timed out — try again", 504);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("deepgram error", res.status, detail.slice(0, 500));
    if (res.status === 401) {
      return proLicenseId
        ? errorJson("Transcription unavailable — try again later", 502)
        : errorJson("Deepgram rejected your API key — check Settings", 401);
    }
    return errorJson(`Transcription failed (${res.status})`, 502);
  }

  // Meter Pro usage on success: 16 kHz × 16-bit mono WAV is 32,000 bytes/s
  // (the 44-byte header is noise at this scale).
  if (proLicenseId) void meterUsage(proLicenseId, Math.round(audio.length / 32_000), 0);

  const body = (await res.json()) as DeepgramResponse;
  const channel = body.results?.channels?.[0];
  const text = (channel?.alternatives?.[0]?.transcript ?? "").trim();
  // detected_language is present only when detect_language=true; otherwise fall
  // back to the hint we were given.
  const detected = channel?.detected_language ?? language;

  return json({ text, language: detected });
});
