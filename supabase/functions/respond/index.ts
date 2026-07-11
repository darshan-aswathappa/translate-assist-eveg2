// POST /respond — { thread_id, text, language, context[] }.
// Sends the utterance (plus recent conversation context) to Claude, which
// returns an English translation and exactly 3 suggested replies in the
// speaker's language. Persists the turn to Postgres (service role) and locks
// the thread's language on first use. The user's Anthropic key arrives in
// x-anthropic-key and is forwarded, never stored.

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorJson, json, preflight } from "../_shared/cors.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

interface Suggestion {
  native: string;
  roman: string;
  gloss: string;
}

function systemPrompt(language: string): string {
  return `You are a live conversation assistant running on smart glasses. The wearer speaks English. Their conversation partner is speaking ${language} (ISO code). For each utterance you receive:
1. Translate it to natural English.
2. Suggest exactly 3 short, natural replies the wearer could say, written in the partner's language (${language}).

Replies must be brief (speakable in one breath), varied in intent (e.g. affirmative / negative / question), and appropriate to the conversation context provided.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"translation_en":"...","suggestions":[{"native":"reply in ${language} script","roman":"romanization, or empty string if the language already uses Latin script","gloss":"English meaning"},...]}`;
}

function extractJson(text: string): { translation_en?: string; suggestions?: Suggestion[] } | null {
  const trimmed = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeSuggestions(raw: unknown): Suggestion[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map((s) => ({
      native: typeof s.native === "string" ? s.native : "",
      roman: typeof s.roman === "string" ? s.roman : "",
      gloss: typeof s.gloss === "string" ? s.gloss : "",
    }))
    .filter((s) => s.native !== "")
    .slice(0, 3);
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const anthropicKey = req.headers.get("x-anthropic-key") ?? "";
  if (!anthropicKey) return errorJson("Set your API keys in Settings", 401);

  let body: { thread_id?: string; text?: string; language?: string; context?: string[] };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }
  const { thread_id: threadId, text, language } = body;
  if (!threadId || !text || !language) {
    return errorJson("thread_id, text and language are required", 400);
  }
  const context = Array.isArray(body.context) ? body.context.slice(-10) : [];

  const contextBlock =
    context.length > 0
      ? `Recent utterances from the partner (oldest first):\n${context.map((c) => `- ${c}`).join("\n")}\n\n`
      : "";

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 600,
      system: systemPrompt(language),
      messages: [
        { role: "user", content: `${contextBlock}New utterance: ${text}` },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("anthropic error", res.status, detail.slice(0, 500));
    if (res.status === 401) {
      return errorJson("Anthropic rejected your API key — check Settings", 401);
    }
    return errorJson(`Translation failed (${res.status})`, 502);
  }

  const completion = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const rawText = completion.content?.find((c) => c.type === "text")?.text ?? "";
  const parsed = extractJson(rawText);
  if (!parsed || typeof parsed.translation_en !== "string") {
    console.error("unparseable claude output", rawText.slice(0, 500));
    return errorJson("Could not parse translation", 502);
  }
  const suggestions = normalizeSuggestions(parsed.suggestions);

  // Persist the turn; failures are logged but never block the HUD response.
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from("utterances").insert({
      thread_id: threadId,
      original_text: text,
      detected_language: language,
      translation_en: parsed.translation_en,
      suggestions,
    });
    // Lock language + set a title from the first utterance, only if unset.
    const { data: thread } = await supabase
      .from("threads")
      .select("locked_language, title")
      .eq("id", threadId)
      .single();
    const patch: Record<string, string> = {};
    if (thread && !thread.locked_language) patch.locked_language = language;
    if (thread && !thread.title) patch.title = parsed.translation_en.slice(0, 60);
    if (Object.keys(patch).length > 0) {
      await supabase.from("threads").update(patch).eq("id", threadId);
    }
  } catch (err) {
    console.error("persist failed", err instanceof Error ? err.message : String(err));
  }

  return json({ translation_en: parsed.translation_en, suggestions });
});
