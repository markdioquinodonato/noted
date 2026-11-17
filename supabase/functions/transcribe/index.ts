import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import {
  parseProvider,
  providerUrl,
  validateOptions,
  validateWav,
} from "./core.ts";

const MAX_BODY = 1_500_000;
export async function handler(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  const allowed = (Deno.env.get("TRANSCRIPTION_ALLOWED_ORIGINS") ??
    Deno.env.get("ALLOWED_ORIGIN") ?? "").split(",").map((s) => s.trim())
    .filter(Boolean);
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    Vary: "Origin",
    "Access-Control-Allow-Origin": origin && allowed.includes(origin)
      ? origin
      : "",
    "Access-Control-Allow-Headers":
      "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
  const reply = (status: number, data: unknown) =>
    new Response(JSON.stringify(data), { status, headers });
  if (!allowed.length || (origin && !allowed.includes(origin))) {
    return reply(403, { error: "Origin not allowed." });
  }
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") return reply(405, { error: "Use POST." });
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return reply(401, { error: "Sign in to transcribe audio." });
  }
  const url = Deno.env.get("SUPABASE_URL")!,
    anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (!user || authError || user.is_anonymous) {
    return reply(401, {
      error: "A registered, signed-in account is required.",
    });
  }
  const key = Deno.env.get("DEEPGRAM_API_KEY"),
    secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) {
    return reply(413, { error: "Chunk too large." });
  }
  // Bound the stream before parsing multipart data. Content-Length is not trusted.
  let bytes = 0;
  const parts: Uint8Array[] = [];
  const reader = request.body?.getReader();
  if (!reader) return reply(400, { error: "A request body is required." });
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.length;
    if (bytes > MAX_BODY) {
      await reader.cancel();
      return reply(413, { error: "Chunk too large." });
    }
    parts.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  parts.forEach((part) => {
    body.set(part, offset);
    offset += part.length;
  });
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      const command = JSON.parse(new TextDecoder().decode(body));
      if (command.operation !== "status") {
        return reply(400, { error: "Unsupported operation." });
      }
      return reply(200, {
        available: !!key && !!secret,
        provider: "Deepgram",
        model: "nova-3",
        diarizer: "v2",
        reviewLimit: 3,
        maxSeconds: 7200,
        ratePerMinute: configuredRate(),
        accuracyVerified: false,
      });
    } catch {
      return reply(400, { error: "Invalid request." });
    }
  }
  if (!key || !secret) {
    return reply(503, {
      error: "Transcription is not configured by the administrator.",
    });
  }
  let form: FormData, options, wav: Uint8Array<ArrayBuffer>, duration: number;
  try {
    form = await new Response(body, {
      headers: { "content-type": request.headers.get("content-type") ?? "" },
    }).formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || form.get("consent") !== "true") {
      throw new Error();
    }
    options = validateOptions(JSON.parse(String(form.get("options"))));
    wav = new Uint8Array(await audio.arrayBuffer());
    duration = validateWav(wav);
  } catch {
    return reply(400, {
      error:
        "Invalid audio, options, or missing consent. Send mono 16 kHz WAV chunks up to 45 seconds.",
    });
  }
  const noteId = String(form.get("noteId")),
    requestId = String(form.get("requestId"));
  const uuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(noteId) || !uuid.test(requestId)) {
    return reply(400, { error: "Invalid request identifier." });
  }
  const admin = createClient(url, secret, { auth: { persistSession: false } });
  // Hash both payload and options: an idempotency key cannot be reused for different content.
  const optionBytes = new TextEncoder().encode(JSON.stringify(options));
  const toHash = new Uint8Array(wav.length + optionBytes.length);
  toHash.set(wav);
  toHash.set(optionBytes, wav.length);
  const digest = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", toHash)),
  ].map((b) => b.toString(16).padStart(2, "0")).join("");
  const { data: reservation, error: quotaError } = await admin.rpc(
    "reserve_transcription",
    {
      p_user: user.id,
      p_note: noteId,
      p_request: requestId,
      p_digest: digest,
      p_seconds: duration,
    },
  );
  if (quotaError) {
    return reply(quotaError.code === "42501" ? 403 : 503, {
      error: "Could not authorize this note or reserve processing quota.",
    });
  }
  if (reservation?.status === "quota") {
    return reply(429, {
      error:
        "Hourly quota reached: 240 calls / 150 processed minutes, including overlap and retries.",
    });
  }
  if (reservation?.status === "complete") return reply(200, reservation.result);
  if (reservation?.status !== "reserved") {
    return reply(409, {
      error:
        "This request is pending or previously failed. Resume later or retry the failed chunk.",
      retryable: reservation?.status === "failed",
    });
  }
  const started = performance.now();
  let result: unknown,
    status: "complete" | "failed" = "failed",
    version = "unreported",
    languages: string[] = [];
  const cost = configuredRate();
  try {
    const response = await fetch(
      providerUrl(options, Deno.env.get("DEEPGRAM_VERSION")),
      {
        method: "POST",
        headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
        body: wav,
        signal: AbortSignal.timeout(65_000),
      },
    );
    if (!response.ok) throw new Error("Provider unavailable");
    const parsed = parseProvider(await response.json(), duration);
    version = parsed.version;
    languages = parsed.languages;
    status = "complete";
    result = {
      ...parsed,
      processingMs: Math.round(performance.now() - started),
      estimatedCost: cost === null ? null : duration / 60 * cost,
    };
  } catch {
    // Never log provider responses: they can contain private audio/transcript data.
    result = null;
  }
  const processingMs = Math.round(performance.now() - started);
  const { error: saveError } = await admin.from("transcription_chunks").update({
    status,
    result,
  }).eq("user_id", user.id).eq("request_id", requestId);
  // Only aggregate-safe metadata. Never audio, transcript, hints, note ID, or user ID.
  const { error: metricError } = await admin.rpc("record_transcription_event", {
    p_status: status,
    p_language: languages.length ? languages.sort().join("+") : "unknown",
    p_model: "nova-3",
    p_version: version,
    p_seconds: duration,
    p_ms: processingMs,
    p_cost: status === "complete" && cost !== null
      ? duration / 60 * cost
      : null,
  });
  if (metricError) {
    console.error("Transcription aggregate event could not be saved.");
  }
  if (saveError) {
    return reply(503, {
      error:
        "Could not save the processing result. This chunk remains incomplete.",
    });
  }
  return status === "complete" ? reply(200, result) : reply(502, {
    error:
      "Audio recognition failed or timed out. Original audio is unchanged.",
    retryable: true,
  });
}
function configuredRate(): number | null {
  const raw = Deno.env.get("TRANSCRIPTION_USD_PER_MINUTE");
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? n : null;
}
if (import.meta.main) {
  Deno.serve((request) =>
    handler(request).catch(() =>
      new Response(
        JSON.stringify({ error: "Transcription service unavailable." }),
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
