// Pro-tier license plumbing shared by the edge functions. A license key is
// sold via Stripe (stripe-webhook creates the row), redeemed exactly once by
// the app (license/activate), and from then on the device authenticates with a
// long-lived device token in x-device-token. Only SHA-256 hashes of keys and
// tokens are stored; the plaintext license survives only until activation so
// the checkout success page can display it.

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorJson } from "./cors.ts";

// Crockford base32 — no I/L/O/U, so keys survive being read aloud or retyped.
const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const KEY_GROUPS = 4;
const KEY_GROUP_LEN = 4;

// Fair-use caps, env-tunable so they can be loosened with real usage data.
const DEFAULT_CAP_AUDIO_MINUTES = 300;
const DEFAULT_CAP_CLAUDE_TURNS = 1000;

export interface LicenseRow {
  id: string;
  plan: "monthly" | "yearly";
  status: "active" | "past_due" | "canceled";
  activated_at: string | null;
}

export interface UsageTotals {
  audio_seconds: number;
  claude_turns: number;
}

export interface Caps {
  audio_seconds: number;
  claude_turns: number;
}

export function serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** `TA-XXXX-XXXX-XXXX-XXXX` — 16 crypto-random Crockford base32 chars (80 bits). */
export function generateLicenseKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(KEY_GROUPS * KEY_GROUP_LEN));
  const groups: string[] = [];
  for (let g = 0; g < KEY_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < KEY_GROUP_LEN; i++) {
      group += KEY_ALPHABET[bytes[g * KEY_GROUP_LEN + i] % KEY_ALPHABET.length];
    }
    groups.push(group);
  }
  return `TA-${groups.join("-")}`;
}

/** 32 random bytes, base64url — the device's long-lived Pro credential. */
export function generateDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export function caps(): Caps {
  const minutes = Number(Deno.env.get("PRO_CAP_AUDIO_MINUTES")) || DEFAULT_CAP_AUDIO_MINUTES;
  const turns = Number(Deno.env.get("PRO_CAP_CLAUDE_TURNS")) || DEFAULT_CAP_CLAUDE_TURNS;
  return { audio_seconds: minutes * 60, claude_turns: turns };
}

/** First day of the current UTC month — the usage_periods bucket key. */
export function currentPeriodStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export async function currentUsage(licenseId: string): Promise<UsageTotals> {
  const { data } = await serviceClient()
    .from("usage_periods")
    .select("audio_seconds, claude_turns")
    .eq("license_id", licenseId)
    .eq("period_start", currentPeriodStart())
    .maybeSingle();
  return {
    audio_seconds: (data as UsageTotals | null)?.audio_seconds ?? 0,
    claude_turns: (data as UsageTotals | null)?.claude_turns ?? 0,
  };
}

export interface ProAuth {
  license: LicenseRow;
  usage: UsageTotals;
}

/** Validate the x-device-token header against an active license. Which caps to
 * enforce depends on the caller: transcribe/dg-token meter audio, respond
 * meters Claude turns. Returns an error Response ready to send, or the
 * license + current-period usage. */
export async function resolveProAuth(
  req: Request,
  check: { audioCap?: boolean; turnCap?: boolean } = {},
): Promise<ProAuth | Response> {
  const token = req.headers.get("x-device-token") ?? "";
  if (!token) return errorJson("Missing device token", 401);

  const tokenHash = await sha256Hex(token);
  const { data } = await serviceClient()
    .from("licenses")
    .select("id, plan, status, activated_at")
    .eq("device_token_hash", tokenHash)
    .maybeSingle();
  const license = data as LicenseRow | null;
  if (!license) return errorJson("Invalid device token — re-activate Pro in Settings", 401);
  if (license.status !== "active") {
    return errorJson("Subscription inactive — check billing", 403);
  }

  const usage = await currentUsage(license.id);
  const limit = caps();
  if (check.audioCap && usage.audio_seconds >= limit.audio_seconds) {
    return errorJson("Monthly fair-use audio limit reached", 429);
  }
  if (check.turnCap && usage.claude_turns >= limit.claude_turns) {
    return errorJson("Monthly fair-use translation limit reached", 429);
  }
  return { license, usage };
}

/** Record usage after a successful upstream call. Fire-and-forget: metering
 * must never block or fail the HUD response (same philosophy as respond's
 * persist block). */
export async function meterUsage(
  licenseId: string,
  audioSeconds: number,
  claudeTurns: number,
): Promise<void> {
  try {
    await serviceClient().rpc("increment_usage", {
      p_license_id: licenseId,
      p_audio_seconds: audioSeconds,
      p_claude_turns: claudeTurns,
    });
  } catch (err) {
    console.error("meter failed", err instanceof Error ? err.message : String(err));
  }
}
