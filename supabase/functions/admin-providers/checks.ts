import { cloudflareMetrics, type Metric } from "./core.ts";

const checked = (
  metric: string,
  source: string,
  detail: string,
  status: Metric["status"],
  value: number | null = null,
): Metric => ({
  metric,
  source,
  detail,
  status,
  value,
  start: null,
  end: null,
});

async function probe(url: string, options?: RequestInit) {
  return await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
}

export async function healthMetrics(
  url: string,
  anon: string,
): Promise<Metric[]> {
  const frontend = async () => {
    try {
      const response = await probe("https://noted-ph.pages.dev/release.json", {
        redirect: "error",
      });
      const metadata =
        response.ok && response.headers.get("content-type")?.includes("json")
          ? await response.json()
          : null;
      const ok = metadata && typeof metadata.version === "string" &&
        typeof metadata.builtAt === "string";
      return checked(
        "frontend_health",
        "Cloudflare Pages",
        ok
          ? "Production release metadata responded successfully."
          : "Production release metadata did not return the expected response.",
        ok ? "available" : "error",
        response.ok ? 1 : 0,
      );
    } catch {
      return checked(
        "frontend_health",
        "Cloudflare Pages",
        "Production frontend probe failed.",
        "error",
        0,
      );
    }
  };
  const edge = async () => {
    try {
      const response = await probe(url + "/functions/v1/transcribe", {
        method: "POST",
        headers: {
          apikey: anon,
          Authorization: "Bearer " + anon,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operation: "status" }),
      });
      // The anonymous JWT is accepted at the gateway and has no user session. The
      // transcribe handler returns its own JSON 401 before touching user data.
      const data = await response.json().catch(() => null);
      const ok = response.status === 401 &&
        data?.error === "A registered, signed-in account is required.";
      return checked(
        "edge_health",
        "Transcription Edge Function",
        ok
          ? "The transcription handler responded with the expected authorization check."
          : "The transcription handler did not return its expected response.",
        ok ? "available" : "error",
        0,
      );
    } catch {
      return checked(
        "edge_health",
        "Transcription Edge Function",
        "The transcription handler probe failed.",
        "error",
        0,
      );
    }
  };
  const deepgram = async () => {
    const key = Deno.env.get("DEEPGRAM_API_KEY");
    if (!key) {
      return checked(
        "deepgram_health",
        "Deepgram Auth API",
        "Deepgram credentials are unconfigured.",
        "unavailable",
      );
    }
    try {
      const response = await probe("https://api.deepgram.com/v1/auth/grant", {
        method: "POST",
        headers: {
          Authorization: "Token " + key,
          "Content-Type": "application/json",
        },
        body: "{}",
        redirect: "error",
      });
      const keyRejected = response.status === 401 || response.status === 403;
      await response.body?.cancel();
      return checked(
        "deepgram_health",
        "Deepgram Auth API",
        response.ok
          ? "Deepgram accepted the configured credentials."
          : keyRejected
          ? "Deepgram rejected the credential or its permission for this probe."
          : "Deepgram did not respond successfully.",
        response.ok ? "available" : "error",
        keyRejected ? 1 : 0,
      );
    } catch {
      return checked(
        "deepgram_health",
        "Deepgram Auth API",
        "Deepgram could not be reached.",
        "error",
        0,
      );
    }
  };
  return await Promise.all([frontend(), edge(), deepgram()]);
}

type Traffic = { day: string; requests: number; errors: number; bytes: number };
type CloudRow = {
  dimensions?: {
    date?: string;
    datetimeHour?: string;
    edgeResponseStatus?: number;
  };
  count?: number;
  sum?: { edgeResponseBytes?: number };
};

const trafficKeys = [
  "cloudflare_page_requests",
  "cloudflare_page_errors",
  "cloudflare_bandwidth_bytes",
];

export async function pagesTraffic(
  token?: string,
  zone?: string,
  host?: string,
): Promise<{ metrics: Metric[]; traffic: Traffic[] }> {
  const source = "Cloudflare zone GraphQL Analytics";
  if (!token || !zone || !host) {
    return {
      metrics: trafficKeys.map((key) =>
        checked(
          key,
          source,
          "A scoped zone token, zone ID and Pages hostname are required.",
          "unavailable",
        )
      ),
      traffic: [],
    };
  }
  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - 86_400_000).toISOString();
  const dayStart =
    new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10) +
    "T00:00:00Z";
  const query =
    `query($zone: string!, $host: string!, $start: Time!, $dayStart: Time!, $end: Time!) {
    viewer { zones(filter: { zoneTag: $zone }) {
      latest: httpRequestsAdaptiveGroups(limit: 1000, filter: {
        clientRequestHTTPHost: $host, datetime_geq: $start, datetime_leq: $end
      }) { count dimensions { edgeResponseStatus } sum { edgeResponseBytes } }
      daily: httpRequestsAdaptiveGroups(limit: 5000, filter: {
        clientRequestHTTPHost: $host, datetime_geq: $dayStart, datetime_leq: $end
      }) { count dimensions { date edgeResponseStatus } sum { edgeResponseBytes } }
    } }
  }`;
  const aggregate = (rows: CloudRow[], cap: number, dated: boolean) => {
    if (!Array.isArray(rows) || rows.length >= cap) {
      throw new Error("Incomplete analytics");
    }
    const out = new Map<string, Traffic>();
    for (const r of rows) {
      const day = dated ? r.dimensions?.date : start.slice(0, 10);
      const status = r.dimensions?.edgeResponseStatus;
      if (
        !day || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(status) ||
        !Number.isSafeInteger(r.count) ||
        !Number.isSafeInteger(r.sum?.edgeResponseBytes)
      ) throw new Error("Missing measurements");
      const value = out.get(day) ?? { day, requests: 0, errors: 0, bytes: 0 };
      value.requests += r.count!;
      value.bytes += r.sum!.edgeResponseBytes!;
      if (status! >= 500 && status! < 600) value.errors += r.count!;
      out.set(day, value);
    }
    return [...out.values()];
  };
  try {
    const response = await probe(
      "https://api.cloudflare.com/client/v4/graphql",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          variables: { zone, host, start, dayStart, end },
        }),
      },
    );
    const result = await response.json();
    const rows = result.data?.viewer?.zones?.[0];
    if (!response.ok || result.errors?.length || !rows) {
      throw new Error("Unauthorized analytics");
    }
    const [latest] = aggregate(rows.latest, 1000, false);
    return {
      metrics: trafficKeys.map((key, i) => ({
        ...checked(
          key,
          source,
          "Rolling 24 hours for the configured hostname. Adaptive sampling may apply.",
          "available",
          latest ? [latest.requests, latest.errors, latest.bytes][i] : 0,
        ),
        start,
        end,
      })),
      traffic: aggregate(rows.daily, 5000, true),
    };
  } catch {
    return {
      metrics: trafficKeys.map((key) =>
        checked(
          key,
          source,
          "The zone dataset was inaccessible or incomplete.",
          "error",
        )
      ),
      traffic: [],
    };
  }
}

export async function configuredCloudflareMetrics() {
  const token = Deno.env.get("CLOUDFLARE_ANALYTICS_TOKEN");
  const account = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  const project = Deno.env.get("CLOUDFLARE_PAGES_PROJECT") ?? "noted-ph";
  const [base, zone] = await Promise.all([
    token && account
      ? cloudflareMetrics(
        token,
        account,
        project,
        Deno.env.get("CLOUDFLARE_WORKER_SCRIPT"),
      )
      : Promise.resolve([]),
    pagesTraffic(
      token,
      Deno.env.get("CLOUDFLARE_ZONE_ID"),
      Deno.env.get("CLOUDFLARE_PAGES_HOSTNAME"),
    ),
  ]);
  return { metrics: [...base, ...zone.metrics], traffic: zone.traffic };
}

export async function supabaseMetrics(projectUrl: string): Promise<Metric[]> {
  const source = "Supabase Management API";
  const token = Deno.env.get("SUPABASE_MONITORING_TOKEN");
  const ref = new URL(projectUrl).hostname.split(".")[0];
  if (!token || !/^[a-z]{20}$/.test(ref)) return [];
  try {
    const response = await probe(
      `https://api.supabase.com/v1/projects/${ref}/analytics/endpoints/usage.api-counts`,
      {
        headers: { Authorization: "Bearer " + token },
        redirect: "error",
      },
    );
    const payload = await response.json();
    const rows = payload.result;
    const keys = [
      "total_auth_requests",
      "total_realtime_requests",
      "total_rest_requests",
      "total_storage_requests",
    ];
    if (
      !response.ok || payload.error || !Array.isArray(rows) || !rows.length ||
      rows.some((row) =>
        !Number.isFinite(Date.parse(row.timestamp)) ||
        keys.some((key) => !Number.isFinite(row[key]))
      )
    ) {
      throw new Error("Incomplete Supabase API measurements");
    }
    const samples = rows.map((row) => new Date(row.timestamp).toISOString())
      .sort();
    const value = rows.reduce(
      (total, row) => total + keys.reduce((sum, key) => sum + row[key], 0),
      0,
    );
    return [{
      ...checked(
        "supabase_api_requests",
        source,
        "Auth, Realtime, REST and Storage requests over the returned reporting interval.",
        "available",
        value,
      ),
      start: samples[0],
      end: samples.at(-1) ?? null,
    }];
  } catch {
    return [
      checked(
        "supabase_api_requests",
        source,
        "The API counts feed was inaccessible or incomplete.",
        "error",
      ),
    ];
  }
}
