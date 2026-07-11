// Thread (session) management — no login, single-user personal app.
//   POST   /threads          → create a thread, returns { id }
//   GET    /threads          → { threads: [...] } newest first
//   GET    /threads?id=...   → thread with its utterances (oldest first)
//   DELETE /threads?id=...   → delete thread (utterances cascade)

import { createClient } from "npm:@supabase/supabase-js@2";
import { errorJson, json, preflight } from "../_shared/cors.ts";

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

Deno.serve(async (req: Request) => {
  const pre = preflight(req);
  if (pre) return pre;

  const id = new URL(req.url).searchParams.get("id");
  const supabase = db();

  if (req.method === "POST") {
    const { data, error } = await supabase.from("threads").insert({}).select("id").single();
    if (error) return errorJson(error.message, 500);
    return json({ id: data.id });
  }

  if (req.method === "GET" && !id) {
    const { data, error } = await supabase
      .from("threads")
      .select("id, title, locked_language, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return errorJson(error.message, 500);
    return json({ threads: data });
  }

  if (req.method === "GET" && id) {
    const { data: thread, error } = await supabase
      .from("threads")
      .select("id, title, locked_language, created_at")
      .eq("id", id)
      .single();
    if (error) return errorJson("Thread not found", 404);
    const { data: utterances, error: uErr } = await supabase
      .from("utterances")
      .select("id, created_at, original_text, translation_en, suggestions")
      .eq("thread_id", id)
      .order("created_at", { ascending: true });
    if (uErr) return errorJson(uErr.message, 500);
    return json({ ...thread, utterances });
  }

  if (req.method === "DELETE" && id) {
    const { error } = await supabase.from("threads").delete().eq("id", id);
    if (error) return errorJson(error.message, 500);
    return json({ ok: true });
  }

  return errorJson("Method not allowed", 405);
});
