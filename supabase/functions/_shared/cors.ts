// Shared CORS + JSON helpers. The G2 app runs in the Even WebView where full
// browser CORS applies, so every function must answer preflights and echo
// permissive headers. The user's API keys travel in x-deepgram-key/x-anthropic-key.

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-deepgram-key, x-anthropic-key, x-device-token",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
} as const;

export function preflight(req: Request): Response | null {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return null;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function errorJson(message: string, status: number): Response {
  return json({ error: message }, status);
}
