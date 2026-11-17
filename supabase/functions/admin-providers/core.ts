export interface Metric {
  metric: string;
  value: number | null;
  source: string;
  status: "available" | "unavailable" | "error";
  detail: string;
  start: string | null;
  end: string | null;
}
export async function cloudflareMetrics(
  token: string | undefined,
  account: string | undefined,
  project: string,
  script: string | undefined,
  fetcher = fetch,
): Promise<Metric[]> {
  const now = new Date(),
    end = now.toISOString(),
    start = new Date(now.getTime() - 86400000).toISOString();
  const make = (
    metric: string,
    value: number | null,
    status: Metric["status"],
    detail: string,
    source: string,
  ): Metric => ({
    metric,
    value,
    status,
    detail,
    source,
    start: metric.startsWith("cloudflare_deployment") ||
        metric === "cloudflare_production"
      ? null
      : start,
    end,
  });
  const missing = !token || !account;
  const metrics: Metric[] = [];
  if (missing) {
    return [
      "cloudflare_requests",
      "cloudflare_errors",
      "cloudflare_deployments",
    ].map((m) =>
      make(
        m,
        null,
        "unavailable",
        "Server-side Cloudflare read credentials are not configured.",
        "Cloudflare API",
      )
    );
  }
  try {
    const r = await fetcher(
      `https://api.cloudflare.com/client/v4/accounts/${
        encodeURIComponent(account!)
      }/pages/projects/${encodeURIComponent(project)}/deployments?per_page=1`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(12000),
      },
    );
    const b = await r.json();
    const total = b.result_info?.total_count;
    // The project endpoint distinguishes production from arbitrary preview builds.
    try {
      const projectResponse = await fetcher(
        `https://api.cloudflare.com/client/v4/accounts/${
          encodeURIComponent(account!)
        }/pages/projects/${encodeURIComponent(project)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(12000),
        },
      );
      const latest = (await projectResponse.json()).result
        ?.canonical_deployment;
      if (projectResponse.ok && latest?.environment === "production") {
        const stage = String(latest.latest_stage?.status ?? "unknown");
        const observed =
          ["success", "active", "failure", "canceled", "idle", "unknown"]
              .includes(stage)
            ? stage
            : "unknown";
        metrics.push({
          ...make(
            "cloudflare_production",
            stage === "success" ? 1 : 0,
            "available",
            `Latest production deployment status: ${observed}.`,
            "Cloudflare Pages API",
          ),
          end: Number.isFinite(Date.parse(latest.modified_on))
            ? latest.modified_on
            : null,
        });
      }
    } catch { /* Keep the previously verified production snapshot. */ }
    metrics.push(
      make(
        "cloudflare_deployments",
        r.ok && b.success && Number.isFinite(total) ? total : null,
        r.ok && b.success && Number.isFinite(total) ? "available" : "error",
        r.ok && b.success && Number.isFinite(total)
          ? "All-time Pages deployments for this project."
          : "Pages API did not provide an authorized deployment total.",
        "Cloudflare Pages API",
      ),
    );
  } catch {
    metrics.push(
      make(
        "cloudflare_deployments",
        null,
        "error",
        "Pages API request failed.",
        "Cloudflare Pages API",
      ),
    );
  }
  if (!script) {
    return [
      ...metrics,
      ...["cloudflare_requests", "cloudflare_errors"].map((m) =>
        make(
          m,
          null,
          "unavailable",
          "Set CLOUDFLARE_WORKER_SCRIPT for a known Worker. Static Pages traffic is not Worker invocations.",
          "Cloudflare Analytics API",
        )
      ),
    ];
  }
  try {
    const query =
      "query($accountTag: string, $datetimeStart: string, $datetimeEnd: string, $scriptName: string){viewer{accounts(filter:{accountTag:$accountTag}){workersInvocationsAdaptive(limit:10000,filter:{scriptName:$scriptName,datetime_geq:$datetimeStart,datetime_leq:$datetimeEnd}){sum{requests errors}}}}}";
    const r = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          accountTag: account,
          datetimeStart: start,
          datetimeEnd: end,
          scriptName: script,
        },
      }),
      signal: AbortSignal.timeout(12000),
    });
    const b = await r.json(),
      rows = b.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
    if (
      !r.ok || b.errors?.length || !Array.isArray(rows) || rows.length >= 10000
    ) throw new Error("Unavailable or truncated");
    for (
      const [metric, key] of [["cloudflare_requests", "requests"], [
        "cloudflare_errors",
        "errors",
      ]]
    ) {
      if (
        rows.some((x: { sum: Record<string, number> }) =>
          !Number.isFinite(x.sum?.[key])
        )
      ) throw new Error("Missing sums");
      metrics.push(
        make(
          metric,
          rows.reduce(
            (s: number, x: { sum: Record<string, number> }) => s + x.sum[key],
            0,
          ),
          "available",
          "Last 24 hours for the configured Worker; adaptive sampling may apply.",
          "Cloudflare GraphQL Analytics API",
        ),
      );
    }
  } catch {
    for (const m of ["cloudflare_requests", "cloudflare_errors"]) {
      metrics.push(
        make(
          m,
          null,
          "error",
          "Analytics unavailable, unauthorized, or truncated; no zero inferred.",
          "Cloudflare GraphQL Analytics API",
        ),
      );
    }
  }
  return metrics;
}
