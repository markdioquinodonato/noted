import { handler } from "./index.ts";
function assert(v: unknown): asserts v {
  if (!v) throw new Error("Assertion failed");
}
Deno.test("operational reports exclude content and never trust a client supplied user identity", async () => {
  for (
    const [k, v] of Object.entries({
      TRANSCRIPTION_ALLOWED_ORIGINS: "https://noted.test",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "private-service-key",
    })
  ) Deno.env.set(k, v);
  const original = globalThis.fetch;
  let stored: Record<string, unknown> | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({
          id: "80000000-0000-4000-8000-000000000002",
          is_anonymous: false,
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (url.includes("/rpc/record_app_event")) {
      stored = JSON.parse(String(init?.body));
      return new Response("true", {
        headers: { "Content-Type": "application/json" },
      });
    }
    throw new Error("Unexpected test request");
  }) as typeof fetch;
  const request = (authenticated = false) =>
    new Request("https://example.test/app-events", {
      method: "POST",
      headers: {
        Origin: "https://noted.test",
        Authorization: "Bearer test",
        "Content-Type": "application/json",
        "x-forwarded-for": "192.0.2.1",
      },
      body: JSON.stringify({
        visitor: "80000000-0000-4000-8000-000000000004",
        platform: "web",
        code: "activity",
        authenticated,
        user_id: "FORGED OWNER",
        note: "private text",
      }),
    });
  try {
    assert((await handler(request())).status === 204);
    assert(stored?.p_user === null);
    assert(!JSON.stringify(stored).includes("private text"));
    assert(!JSON.stringify(stored).includes("192.0.2.1"));
    assert(!JSON.stringify(stored).includes("FORGED OWNER"));
    assert((await handler(request(true))).status === 204);
    assert(stored?.p_user === "80000000-0000-4000-8000-000000000002");
  } finally {
    globalThis.fetch = original;
  }
});
