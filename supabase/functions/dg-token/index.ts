// POST /dg-token — mint a short-lived Deepgram access token for Pro live
// streaming. The app's WebSocket connects straight to Deepgram (a proxy would
// add latency), but the owner's API key must never reach the device — so the
// device trades its x-device-token for a ~60s JWT via Deepgram's grant
// endpoint. The JWT only needs to be valid at connection-open time; the app
// re-mints before every connect/reconnect. This is also the streaming
// enforcement point: an over-cap or inactive license can't open new streams.

import { errorJson, json, preflight } from "../_shared/cors.ts";
import { resolveProAuth } from "../_shared/license.ts";

const DEEPGRAM_GRANT_URL = "https://api.deepgram.com/v1/auth/grant";
const TOKEN_TTL_SECONDS = 60;
const UPSTREAM_TIMEOUT_MS = 8_000;

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return errorJson("Method not allowed", 405);

  const auth = await resolveProAuth(req, { audioCap: true });
  if (auth instanceof Response) return auth;

  let res: Response;
  try {
    res = await fetch(DEEPGRAM_GRANT_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${Deno.env.get("DEEPGRAM_API_KEY") ?? ""}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: TOKEN_TTL_SECONDS }),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (err) {
    console.error("deepgram grant failed", err instanceof Error ? err.message : String(err));
    return errorJson("Could not reach Deepgram — try again", 504);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("deepgram grant error", res.status, detail.slice(0, 500));
    return errorJson(`Token mint failed (${res.status})`, 502);
  }

  const body = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) return errorJson("Deepgram returned no token", 502);
  return json({ access_token: body.access_token, expires_in: body.expires_in ?? TOKEN_TTL_SECONDS });
});
