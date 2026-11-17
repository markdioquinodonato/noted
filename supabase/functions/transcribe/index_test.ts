import { handler } from "./index.ts";

const USER = "70000000-0000-4000-8000-000000000001",
  NOTE = "70000000-0000-4000-8000-000000000002",
  REQUEST = "70000000-0000-4000-8000-000000000003";
function assert(value: unknown, message = "Assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function wav() {
  const bytes = new Uint8Array(32044), view = new DataView(bytes.buffer);
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => bytes[at + i] = c.charCodeAt(0));
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, 32000, true);
  return bytes;
}
function request(
  options: { consent?: boolean; audio?: Uint8Array<ArrayBuffer> } = {},
) {
  const body = new FormData();
  body.set("audio", new Blob([options.audio ?? wav()]), "chunk.wav");
  body.set("consent", String(options.consent ?? true));
  body.set("noteId", NOTE);
  body.set("requestId", REQUEST);
  body.set(
    "options",
    JSON.stringify({
      language: "multi",
      mode: "strict",
      pass: "primary",
      vocabulary: ["private name"],
    }),
  );
  return new Request("https://example.test/transcribe", {
    method: "POST",
    headers: {
      origin: "https://noted.test",
      authorization: "Bearer test-token",
    },
    body,
  });
}
Deno.test("HTTP handler contract: auth, validation, idempotency, provider errors, privacy", async (t) => {
  for (
    const [key, value] of Object.entries({
      ALLOWED_ORIGIN: "https://noted.test",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_ANON_KEY: "test-anon",
      SUPABASE_SERVICE_ROLE_KEY: "test-service",
      DEEPGRAM_API_KEY: "test-provider",
      TRANSCRIPTION_USD_PER_MINUTE: "0.0112",
    })
  ) Deno.env.set(key, value);
  const originalFetch = globalThis.fetch;
  let reservation = "reserved",
    providerCalls = 0,
    providerFails = false,
    anonymous = false;
  const events: Record<string, unknown>[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/auth/v1/user")) {
      return json({
        id: USER,
        email: "user@gmail.com",
        is_anonymous: anonymous,
      });
    }
    if (url.includes("/rpc/reserve_transcription")) {
      return json({
        status: reservation,
        result: reservation === "complete"
          ? { text: "cached private result" }
          : undefined,
      });
    }
    if (url.includes("api.deepgram.com")) {
      providerCalls++;
      assert(url.includes("diarize_model=v2"));
      assert(url.includes("redact_usage=true"));
      assert(!url.includes("translate="));
      if (providerFails) {
        return json({ transcript: "private provider error" }, 503);
      }
      return json({
        metadata: {
          duration: 1,
          model_info: { id: { name: "nova", version: "contract" } },
          diarize_info: { arch: "v2" },
        },
        results: {
          channels: [{
            alternatives: [{
              transcript: "po",
              words: [{
                word: "po",
                start: 0,
                end: 0.4,
                confidence: 0.98,
                speaker: 0,
                speaker_confidence: 0.8,
                language: "tl",
              }],
            }],
          }],
        },
      });
    }
    if (url.includes("/rpc/record_transcription_event")) {
      events.push(JSON.parse(String(init?.body)));
      return new Response(null, { status: 204 });
    }
    if (url.includes("/rest/v1/transcription_chunks")) {
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected test request ${new URL(url).pathname}`);
  }) as typeof fetch;
  try {
    await t.step("rejects disallowed origins and missing auth", async () => {
      assert(
        (await handler(
          new Request("https://example.test", {
            method: "POST",
            headers: { origin: "https://evil.test" },
          }),
        )).status === 403,
      );
      assert(
        (await handler(
          new Request("https://example.test", {
            method: "POST",
            headers: { origin: "https://noted.test" },
          }),
        )).status === 401,
      );
    });
    await t.step(
      "rejects anonymous users, absent consent and invalid audio before provider calls",
      async () => {
        anonymous = true;
        assert((await handler(request())).status === 401);
        anonymous = false;
        assert((await handler(request({ consent: false }))).status === 400);
        assert(
          (await handler(request({ audio: new Uint8Array(5) }))).status === 400,
        );
        assert(providerCalls === 0);
      },
    );
    await t.step(
      "returns provider words but saves only aggregate metadata in monitoring",
      async () => {
        const response = await handler(request()), body = await response.json();
        assert(response.status === 200);
        assert(body.words[0].word === "po");
        assert(body.diarizer === "v2");
        assert(providerCalls === 1);
        assert(response.headers.get("cache-control") === "no-store");
        assert(events.length === 1);
        const event = JSON.stringify(events[0]);
        assert(
          !event.includes(USER) && !event.includes(NOTE) &&
            !event.includes("private name") && !event.includes('"po"'),
        );
      },
    );
    await t.step(
      "cached, pending and quota requests never call the provider again",
      async () => {
        reservation = "complete";
        assert((await handler(request())).status === 200);
        reservation = "processing";
        assert((await handler(request())).status === 409);
        reservation = "quota";
        assert((await handler(request())).status === 429);
        assert(providerCalls === 1);
      },
    );
    await t.step(
      "provider errors never echo transcript content and remain retryable",
      async () => {
        reservation = "reserved";
        providerFails = true;
        const response = await handler(request()), text = await response.text();
        assert(response.status === 502);
        assert(!text.includes("private provider error"));
        assert(JSON.parse(text).retryable === true);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
