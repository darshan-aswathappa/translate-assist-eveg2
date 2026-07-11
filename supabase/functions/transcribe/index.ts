// POST /transcribe[?language=xx] — body: audio/wav bytes.
// Pass-through proxy to Groq's Whisper (whisper-large-v3-turbo). The user's
// Groq key arrives in x-groq-key and is forwarded, never stored. Returns
// { text, language } where language is an ISO-639-1 code suitable for the
// thread language lock (Whisper reports full names like "japanese").

import { errorJson, json, preflight } from "../_shared/cors.ts";

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = "whisper-large-v3-turbo";

// Whisper verbose_json reports full lowercase language names; the `language`
// request param wants ISO-639-1. Map the common ones; fall back to the raw name.
const LANGUAGE_CODES: Record<string, string> = {
  english: "en", japanese: "ja", korean: "ko", chinese: "zh", mandarin: "zh",
  cantonese: "yue", spanish: "es", french: "fr", german: "de", italian: "it",
  portuguese: "pt", russian: "ru", arabic: "ar", hindi: "hi", kannada: "kn",
  tamil: "ta", telugu: "te", malayalam: "ml", bengali: "bn", urdu: "ur",
  dutch: "nl", polish: "pl", turkish: "tr", vietnamese: "vi", thai: "th",
  indonesian: "id", malay: "ms", tagalog: "tl", swedish: "sv", norwegian: "no",
  danish: "da", finnish: "fi", greek: "el", hebrew: "he", czech: "cs",
  slovak: "sk", ukrainian: "uk", romanian: "ro", hungarian: "hu", bulgarian: "bg",
  croatian: "hr", serbian: "sr", catalan: "ca", persian: "fa", swahili: "sw",
};

function toIsoCode(language: string): string {
  const lower = language.trim().toLowerCase();
  if (/^[a-z]{2}$/.test(lower)) return lower;
  return LANGUAGE_CODES[lower] ?? lower;
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const groqKey = req.headers.get("x-groq-key") ?? "";
  if (!groqKey) return errorJson("Set your API keys in Settings", 401);

  const audio = new Uint8Array(await req.arrayBuffer());
  if (audio.length < 100) return errorJson("Empty audio", 400);

  const language = new URL(req.url).searchParams.get("language") ?? "";

  const form = new FormData();
  form.append("file", new Blob([audio], { type: "audio/wav" }), "utterance.wav");
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  if (language) form.append("language", language);

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey}` },
    body: form,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("groq error", res.status, detail.slice(0, 500));
    if (res.status === 401) return errorJson("Groq rejected your API key — check Settings", 401);
    return errorJson(`Transcription failed (${res.status})`, 502);
  }

  const body = (await res.json()) as { text?: string; language?: string };
  return json({
    text: (body.text ?? "").trim(),
    language: toIsoCode(body.language ?? language),
  });
});
