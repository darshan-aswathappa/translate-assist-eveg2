// Runtime configuration, sourced from Vite env vars (see .env.example).
// The Supabase URL + publishable key identify our backend project; the user's
// Deepgram / Anthropic API keys are NOT here — they are entered in the phone
// Settings screen and persisted via bridge.setLocalStorage.

const env = import.meta.env;

// Dev mode (VITE_DEV_MODE=true): skip audio capture and drive the HUD + phone UI
// from canned fixtures, so layout can be iterated without glasses or a backend.
export const DEV_MODE = (env.VITE_DEV_MODE ?? "false") === "true";

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "");
export const SUPABASE_PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "";

export const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;

// Stripe Payment Link URLs for the Pro tier (created once in the Stripe
// dashboard/MCP; static, so they ship as build-time env).
export const CHECKOUT_URL_MONTHLY = env.VITE_CHECKOUT_URL_MONTHLY ?? "";
export const CHECKOUT_URL_YEARLY = env.VITE_CHECKOUT_URL_YEARLY ?? "";

// A transcription of one utterance is a single short request; translation can
// take a couple of seconds of Claude thinking time.
export const TRANSCRIBE_TIMEOUT_MS = 20_000;
export const RESPOND_TIMEOUT_MS = 30_000;

// bridge.setLocalStorage keys for user-entered settings.
export const STORAGE_KEYS = {
  deepgramKey: "ta.deepgram_key",
  anthropicKey: "ta.anthropic_key",
  activeThreadId: "ta.active_thread",
  keyterms: "ta.keyterms",
  deviceToken: "ta.device_token",
  plan: "ta.plan",
} as const;
