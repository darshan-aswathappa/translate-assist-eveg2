// POST /license — Pro license lifecycle, JSON body { action, … }:
//   "activate" { license_key }   — one-time redemption. Returns { device_token,
//                                  plan }; the token is generated here, only
//                                  its hash is stored, and the plaintext
//                                  license is nulled so the success page stops
//                                  showing it. A second activation gets 409.
//   "status"   { device_token }  — plan/status + current-period usage vs caps,
//                                  for the Settings plan card. Answers even for
//                                  past_due/canceled so the UI can explain.
//   "report"   { device_token, audio_seconds } — client-reported live-streaming
//                                  seconds (the WebSocket bypasses our proxy).
//                                  Clamped per report; a soft fair-use meter.

import { errorJson, json, preflight } from "../_shared/cors.ts";
import {
  caps,
  currentUsage,
  generateDeviceToken,
  serviceClient,
  sha256Hex,
  type LicenseRow,
} from "../_shared/license.ts";

// One report covers at most one flush interval plus reconnect slop.
const MAX_REPORT_SECONDS = 900;

function normalizeLicenseKey(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

async function activate(licenseKey: string): Promise<Response> {
  const normalized = normalizeLicenseKey(licenseKey);
  if (!normalized) return errorJson("license_key is required", 400);
  // The canonical form is TA-XXXX-XXXX-XXXX-XXXX; hash the dashed form.
  const groups = normalized.replace(/^TA/, "").match(/.{1,4}/g) ?? [];
  const canonical = `TA-${groups.join("-")}`;
  const keyHash = await sha256Hex(canonical);

  const supabase = serviceClient();
  const { data: found } = await supabase
    .from("licenses")
    .select("id, plan, status, activated_at, device_token_hash")
    .eq("license_key_hash", keyHash)
    .maybeSingle();
  const license = found as (LicenseRow & { device_token_hash: string | null }) | null;

  if (!license) return errorJson("License key not found — check for typos", 404);
  if (license.device_token_hash) {
    return errorJson("This key was already activated on a device", 409);
  }
  if (license.status !== "active") {
    return errorJson("Subscription is not active — check billing", 403);
  }

  const deviceToken = generateDeviceToken();
  // Conditional update guards the single-use invariant against a racing
  // activation: only one caller finds device_token_hash still null.
  const { data: updated } = await supabase
    .from("licenses")
    .update({
      device_token_hash: await sha256Hex(deviceToken),
      activated_at: new Date().toISOString(),
      license_key_plain: null,
    })
    .eq("id", license.id)
    .is("device_token_hash", null)
    .select("id");
  if (!updated || updated.length === 0) {
    return errorJson("This key was already activated on a device", 409);
  }

  return json({ device_token: deviceToken, plan: license.plan });
}

async function findByDeviceToken(deviceToken: string): Promise<LicenseRow | null> {
  const { data } = await serviceClient()
    .from("licenses")
    .select("id, plan, status, activated_at")
    .eq("device_token_hash", await sha256Hex(deviceToken))
    .maybeSingle();
  return data as LicenseRow | null;
}

async function status(deviceToken: string): Promise<Response> {
  const license = await findByDeviceToken(deviceToken);
  if (!license) return errorJson("Invalid device token — re-activate Pro in Settings", 401);
  const usage = await currentUsage(license.id);
  return json({
    plan: license.plan,
    status: license.status,
    activated_at: license.activated_at,
    usage,
    caps: caps(),
  });
}

async function report(deviceToken: string, audioSeconds: number): Promise<Response> {
  const license = await findByDeviceToken(deviceToken);
  if (!license) return errorJson("Invalid device token — re-activate Pro in Settings", 401);
  const seconds = Math.min(Math.max(Math.round(audioSeconds), 0), MAX_REPORT_SECONDS);
  if (seconds > 0) {
    await serviceClient().rpc("increment_usage", {
      p_license_id: license.id,
      p_audio_seconds: seconds,
      p_claude_turns: 0,
    });
  }
  return json({ ok: true });
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  let body: { action?: string; license_key?: string; device_token?: string; audio_seconds?: number };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid JSON body", 400);
  }

  switch (body.action) {
    case "activate":
      return activate(typeof body.license_key === "string" ? body.license_key : "");
    case "status":
      if (typeof body.device_token !== "string" || !body.device_token) {
        return errorJson("device_token is required", 400);
      }
      return status(body.device_token);
    case "report":
      if (typeof body.device_token !== "string" || !body.device_token) {
        return errorJson("device_token is required", 400);
      }
      return report(body.device_token, Number(body.audio_seconds) || 0);
    default:
      return errorJson("Unknown action", 400);
  }
});
