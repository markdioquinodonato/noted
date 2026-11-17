import { TrendChart } from './AdminCharts';
import { useAdminRpc } from './adminData';
import { QueryNotice } from './AdminUI';

export function CloudflareTraffic() {
  const history = useAdminRpc<{ day: string; requests: number; errors: number }[]>(
    'admin_cloudflare_history',
  );
  return (
    <>
      <QueryNotice
        error={history.error}
        loading={history.isLoading}
        retry={() => void history.refetch()}
      />
      <TrendChart
        title="Traffic trend"
        description="Daily Pages requests and server errors from the configured Cloudflare zone."
        rows={history.error ? [] : (history.data ?? [])}
        series={[
          { key: 'requests', name: 'Requests' },
          { key: 'errors', name: '5xx responses', dashed: true },
        ]}
        empty="No authorized Pages traffic history has been collected."
      />
    </>
  );
}
