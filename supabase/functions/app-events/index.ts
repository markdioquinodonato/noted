import { createClient } from "npm:@supabase/supabase-js@2.119.0";
const platforms = [
  "web",
  "windows",
  "macos",
  "android",
  "linux",
  "ios",
  "other",
];
const codes = [
  "activity",
  "uncaught_error",
  "unhandled_rejection",
  "route_error",
  "sync_failed",
  "sync_offline",
  "sync_conflict",
];
export async function handler(request: Request) {
  const allowed = (Deno.env.get("TRANSCRIPTION_ALLOWED_ORIGINS") ??
    Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map((x) => x.trim());
  const origin = request.headers.get("origin");
  const headers = {
    "Access-Control-Allow-Origin": origin && allowed.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  const reply = (status: number) => new Response(null, { status, headers });
  if (!origin || !allowed.includes(origin)) return reply(403);
  if (request.method === "OPTIONS") return reply(204);
  if (request.method !== "POST") return reply(405);
  const reader = request.body?.getReader();
  if (!reader) return reply(400);
  let raw = "", bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > 1024) {
      await reader.cancel();
      return reply(413);
    }
    raw += new TextDecoder().decode(value);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply(400);
  }
  if (
    !platforms.includes(body.platform) || !codes.includes(body.code) ||
    typeof body.visitor !== "string" || !/^[a-f0-9-]{36}$/i.test(body.visitor)
  ) return reply(400);
  const url = Deno.env.get("SUPABASE_URL")!,
    secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(url, secret, { auth: { persistSession: false } });
  let user: string | null = null;
  const bearer = request.headers.get("authorization");
  if (body.authenticated === true && bearer?.startsWith("Bearer ")) {
    const token = bearer.slice(7);
    const { data, error } = await sb.auth.getUser(token);
    if (!error && data.user && !data.user.is_anonymous) user = data.user.id;
    else if (body.authenticated === true) return reply(401);
  } else if (body.authenticated === true) return reply(401);
  const day = new Date().toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const hash = async (value: string) =>
    [
      ...new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
      ),
    ].map((x) => x.toString(16).padStart(2, "0")).join("");
  // Network address is hashed immediately and never logged or stored in clear text.
  const network =
    request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ??
      "unknown";
  const { data, error } = await sb.rpc("record_app_event", {
    p_user: user,
    p_actor: await hash(
      `${user ? "user:" + user : day + ":guest:" + body.visitor}`,
    ),
    p_network: await hash(`${day}:network:${network}`),
    p_platform: body.platform,
    p_code: body.code,
  });
  return reply(error ? 503 : data ? 204 : 429);
}
if (import.meta.main) {
  Deno.serve((r) =>
    handler(r).catch(() => new Response(null, { status: 503 }))
  );
}
