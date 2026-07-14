// POST /respond — { thread_id, text, language, context[], mode?, utterance_id? }.
// Sends the utterance (plus recent conversation context) to Claude. Three modes:
//   "full" (default) — translation + exactly 3 suggested replies in one call
//                      (kept for the batch path and Settings key verification).
//   "translate"      — translation only; fast, rendered on the HUD first.
//                      Persists the turn row and returns its utterance_id.
//   "suggest"        — 3 suggested replies for an already-translated utterance;
//                      attaches them to the row named by utterance_id.
// Persists to Postgres (service role) and locks the thread's language on first
// use. The user's Anthropic key arrives in x-anthropic-key and is forwarded,
// never stored.

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorJson, json, preflight } from "../_shared/cors.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
// Below the app's 30s respond timeout, so a hung Anthropic request fails here
// with a clear message instead of burning the client's abort window.
const UPSTREAM_TIMEOUT_MS = 25_000;

type Mode = "full" | "translate" | "suggest";

interface Suggestion {
  native: string;
  roman: string;
  gloss: string;
}

function systemPrompt(language: string, mode: Mode): string {
  const intro = `You are a live conversation assistant running on smart glasses. The wearer speaks English. Their conversation partner is speaking ${language} (ISO code).`;
  if (mode === "translate") {
    return `${intro} Translate each utterance you receive to natural English.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"translation_en":"..."}`;
  }
  if (mode === "suggest") {
    return `${intro} For the utterance you receive, suggest exactly 3 short, natural replies the wearer could say, written in the partner's language (${language}).

Replies must be brief (speakable in one breath), varied in intent (e.g. affirmative / negative / question), and appropriate to the conversation context provided.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"suggestions":[{"native":"reply in ${language} script","roman":"romanization, or empty string if the language already uses Latin script","gloss":"English meaning"},...]}`;
  }
  return `${intro} For each utterance you receive:
1. Translate it to natural English.
2. Suggest exactly 3 short, natural replies the wearer could say, written in the partner's language (${language}).

Replies must be brief (speakable in one breath), varied in intent (e.g. affirmative / negative / question), and appropriate to the conversation context provided.

Respond with ONLY a JSON object, no markdown fences, in this exact shape:
{"translation_en":"...","suggestions":[{"native":"reply in ${language} script","roman":"romanization, or empty string if the language already uses Latin script","gloss":"English meaning"},...]}`;
}

function extractJson(
  text: string,
): { translation_en?: string; suggestions?: Suggestion[] } | null {
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

// Last-resort recovery when the JSON object is malformed or truncated (e.g.
// max_tokens hit mid-suggestions): pull the translation string out by regex so
// the turn degrades to translation-without-suggestions instead of a 502.
function recoverTranslation(text: string): string | null {
  const m = text.match(/"translation_en"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
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

function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const anthropicKey = req.headers.get("x-anthropic-key") ?? "";
  if (!anthropicKey) return errorJson("Set your API keys in Settings", 401);

  let body: {
    thread_id?: string;
    text?: string;
    language?: string;
    context?: string[];
    mode?: string;
    utterance_id?: string;
  };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }
  const { thread_id: threadId, text, language } = body;
  if (!threadId || !text || !language) {
    return errorJson("thread_id, text and language are required", 400);
  }
  const mode: Mode =
    body.mode === "translate" || body.mode === "suggest" ? body.mode : "full";
  const utteranceId = typeof body.utterance_id === "string" ? body.utterance_id : null;
  const context = Array.isArray(body.context) ? body.context.slice(-10) : [];

  const contextBlock =
    context.length > 0
      ? `Recent utterances from the partner (oldest first):\n${context.map((c) => `- ${c}`).join("\n")}\n\n`
      : "";

  let res: Response;
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        // Long utterances need headroom: a truncated JSON object used to fail
        // the whole turn. Suggestions are short and get a smaller budget.
        max_tokens: mode === "suggest" ? 600 : 1500,
        system: systemPrompt(language, mode),
        messages: [
          { role: "user", content: `${contextBlock}New utterance: ${text}` },
        ],
      }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("anthropic fetch failed", err instanceof Error ? err.message : String(err));
    return errorJson("Translation timed out — try again", 504);
  }

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

  if (mode === "suggest") {
    // Suggestions are an enhancement — a parse failure degrades to an empty
    // list rather than failing the call.
    const suggestions = normalizeSuggestions(parsed?.suggestions);
    if (suggestions.length === 0) {
      console.error("no suggestions parsed", rawText.slice(0, 500));
    }
    if (utteranceId && suggestions.length > 0) {
      try {
        await serviceClient()
          .from("utterances")
          .update({ suggestions })
          .eq("id", utteranceId);
      } catch (err) {
        console.error("persist failed", err instanceof Error ? err.message : String(err));
      }
    }
    return json({ translation_en: "", suggestions, utterance_id: utteranceId });
  }

  let translation = typeof parsed?.translation_en === "string" ? parsed.translation_en : null;
  if (!translation) translation = recoverTranslation(rawText);
  if (!translation) {
    console.error("unparseable claude output", rawText.slice(0, 500));
    return errorJson("Could not parse translation", 502);
  }
  const suggestions = mode === "translate" ? [] : normalizeSuggestions(parsed?.suggestions);

  // Persist the turn; failures are logged but never block the HUD response.
  let insertedId: string | null = null;
  try {
    const supabase = serviceClient();
    const { data: inserted } = await supabase
      .from("utterances")
      .insert({
        thread_id: threadId,
        original_text: text,
        detected_language: language,
        translation_en: translation,
        suggestions,
      })
      .select("id")
      .single();
    insertedId = (inserted as { id?: string } | null)?.id ?? null;
    // Lock language + set a title from the first utterance, only if unset.
    const { data: thread } = await supabase
      .from("threads")
      .select("locked_language, title")
      .eq("id", threadId)
      .single();
    const patch: Record<string, string> = {};
    if (thread && !thread.locked_language) patch.locked_language = language;
    if (thread && !thread.title) patch.title = translation.slice(0, 60);
    if (Object.keys(patch).length > 0) {
      await supabase.from("threads").update(patch).eq("id", threadId);
    }
  } catch (err) {
    console.error("persist failed", err instanceof Error ? err.message : String(err));
  }

  return json({ translation_en: translation, suggestions, utterance_id: insertedId });
});
