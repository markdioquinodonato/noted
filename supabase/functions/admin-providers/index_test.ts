import { handler } from "./index.ts";
import { cloudflareMetrics } from "./core.ts";
function assert(v: unknown): asserts v {
  if (!v) throw new Error("Assertion failed");
}
Deno.test("provider feed never invents zero for missing credentials or provider errors", async () => {
  const missing = await cloudflareMetrics(
    undefined,
    undefined,
    "noted-ph",
    undefined,
  );
  assert(missing.every((m) => m.value === null && m.status === "unavailable"));
  const failed = await cloudflareMetrics(
    "private-token",
    "account",
    "noted-ph",
    "worker",
    async () =>
      new Response(
        JSON.stringify({
          success: false,
          errors: [{ message: "private error" }],
        }),
        { status: 403 },
      ),
  );
  assert(failed.every((m) => m.value === null));
  assert(!JSON.stringify(failed).includes("private-token"));
  assert(!JSON.stringify(failed).includes("private error"));
  const actual = await cloudflareMetrics(
    "token",
    "account",
    "noted-ph",
    undefined,
    async () =>
      new Response(
        JSON.stringify({ success: true, result_info: { total_count: 7 } }),
      ),
  );
  assert(
    actual.find((m) => m.metric === "cloudflare_deployments")?.value === 7,
  );
  assert(
    actual.find((m) => m.metric === "cloudflare_deployments")?.start === null,
  );
});
Deno.test("admin HTTP API rejects ordinary users and low assurance before reading providers", async () => {
  for (
    const [k, v] of Object.entries({
      TRANSCRIPTION_ALLOWED_ORIGINS: "https://noted.test",
      SUPABASE_URL: "https://supabase.test",
      SUPABASE_ANON_KEY: "anon",
      SUPABASE_SERVICE_ROLE_KEY: "service",
    })
  ) Deno.env.set(k, v);
  const original = globalThis.fetch;
  let authorized = false, calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (value: unknown) =>
      new Response(JSON.stringify(value), {
        headers: { "Content-Type": "application/json" },
      });
    if (url.includes("/auth/v1/user")) {
      return json({
        id: "80000000-0000-4000-8000-000000000002",
        is_anonymous: false,
      });
    }
    if (url.includes("/rpc/admin_access")) {
      return json({ member: authorized, authorized });
    }
    if (url.includes("/rpc/authorize_admin_refresh")) return json(false);
    calls++;
    throw new Error("No provider calls permitted in this test");
  }) as typeof fetch;
  const request = () =>
    new Request("https://example.test/admin-providers", {
      method: "POST",
      headers: {
        Origin: "https://noted.test",
        Authorization: "Bearer test-user",
      },
    });
  try {
    assert((await handler(request())).status === 403);
    assert(calls === 0);
    authorized = true;
    assert((await handler(request())).status === 429);
    assert(calls === 0);
  } finally {
    globalThis.fetch = original;
  }
});
Deno.test("scheduled monitoring rejects invalid secrets and applies a server-side budget", async () => {
  Deno.env.set("ADMIN_MONITORING_JOB_TOKEN", "fixture-monitoring-secret");
  Deno.env.set("SUPABASE_URL", "https://supabase.test");
  Deno.env.set("SUPABASE_ANON_KEY", "anon");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input) => {
    calls++;
    assert(String(input).includes("/rpc/admin_authorize_scheduled_probe"));
    return Response.json(false);
  }) as typeof fetch;
  const post = (value: string) =>
    new Request("https://example.test/admin-providers", {
      method: "POST",
      headers: { "x-noted-monitoring-job": value },
    });
  try {
    assert((await handler(post("fixture-invalid---secret"))).status === 403);
    assert((await handler(post("fixture-monitoring-secret"))).status === 429);
    assert(calls === 1);
  } finally {
    Deno.env.delete("ADMIN_MONITORING_JOB_TOKEN");
    globalThis.fetch = original;
  }
});
