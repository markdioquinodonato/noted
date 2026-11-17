import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  configuredCloudflareMetrics,
  healthMetrics,
  supabaseMetrics,
} from "./checks.ts";
async function sameSecret(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length || a.length > 128) return false;
  const encode = new TextEncoder();
  const [left, right] = await Promise.all(
    [a, b].map(async (value) =>
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", encode.encode(value)),
      )
    ),
  );
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export async function handler(request: Request) {
  const origin = request.headers.get("origin"),
    allowed = (Deno.env.get("TRANSCRIPTION_ALLOWED_ORIGINS") ??
      Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map((s) => s.trim());
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin && allowed.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Headers":
      "authorization,apikey,content-type,x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  const reply = (status: number, error?: string) =>
    new Response(JSON.stringify(error ? { error } : { ok: true }), {
      status,
      headers,
    });
  const backgroundSecret = Deno.env.get("ADMIN_MONITORING_JOB_TOKEN");
  const jobHeader = request.headers.get("x-noted-monitoring-job");
  const scheduled = origin === null && request.method === "POST" &&
    !!backgroundSecret &&
    !!jobHeader && await sameSecret(jobHeader, backgroundSecret);
  if (!scheduled && (!origin || !allowed.includes(origin))) {
    return reply(403, "Origin not allowed.");
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return reply(405, "Use POST.");
  if (!scheduled) {
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return reply(401, "Sign in.");
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      },
    );
    const { data: { user }, error } = await sb.auth.getUser();
    if (error || !user || user.is_anonymous) return reply(401, "Sign in.");
    const { data: access, error: accessError } = await sb.rpc("admin_access");
    if (accessError || !access?.authorized) {
      return reply(
        403,
        "Administrator membership and verified MFA are required.",
      );
    }
    const { data: approved, error: limitError } = await sb.rpc(
      "authorize_admin_refresh",
    );
    if (limitError) return reply(403, "Administrator MFA required.");
    if (!approved) return reply(429, "Refresh is limited to once per minute.");
  }
  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const service = createClient(url, secret, {
    auth: { persistSession: false },
  });
  if (scheduled) {
    const { data, error } = await service.rpc(
      "admin_authorize_scheduled_probe",
    );
    if (error) return reply(503, "Scheduled monitoring unavailable.");
    if (!data) return reply(429, "Scheduled monitoring rate limited.");
  }
  const [cloudflare, health, supabase] = await Promise.all([
    configuredCloudflareMetrics(),
    healthMetrics(url, anon),
    supabaseMetrics(url),
  ]);
  const { error: storeError } = await service.rpc(
    "admin_ingest_provider_checks",
    {
      p_metrics: [...cloudflare.metrics, ...health, ...supabase].map((
        { start, end, ...metric },
      ) => ({
        ...metric,
        start_at: start,
        end_at: end,
      })),
      p_traffic: cloudflare.traffic,
    },
  );
  if (storeError) return reply(503, "Could not save provider metrics.");
  return reply(200);
}
if (import.meta.main) {
  Deno.serve((r) =>
    handler(r).catch(() =>
      new Response(
        JSON.stringify({ error: "Provider monitoring unavailable." }),
        {
          status: 503,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      )
    )
  );
}
