import { BetaAnalyticsDataClient } from '@google-analytics/data';

export type Ga4Metric = { label: string; value: number | string; sub?: string };

export type Ga4TrendPoint = { date: string; users: number; sessions: number; views: number };

export type Ga4Report = {
  configured: boolean;
  error?: string;
  last7: Ga4Metric[];
  last30: Ga4Metric[];
  realtime: { activeUsers: number | null; eventCount: number | null };
  trend: Ga4TrendPoint[];
  topPages: { path: string; title: string; views: number; users: number }[];
  channels: { name: string; sessions: number; users: number }[];
  devices: { name: string; sessions: number; users: number }[];
  countries: { name: string; users: number; sessions: number }[];
};

let client: BetaAnalyticsDataClient | null | undefined;

function getClient(): BetaAnalyticsDataClient | null {
  if (client !== undefined) return client;
  const json = process.env.GA_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const creds = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (creds.client_email && creds.private_key) {
        client = new BetaAnalyticsDataClient({
          credentials: { client_email: creds.client_email, private_key: creds.private_key },
        });
        return client;
      }
    } catch {
      client = null;
      return null;
    }
  }
  const email = process.env.GA_CLIENT_EMAIL;
  const key = process.env.GA_PRIVATE_KEY;
  if (email && key) {
    client = new BetaAnalyticsDataClient({
      credentials: { client_email: email, private_key: key.replace(/\\n/g, '\n') },
    });
    return client;
  }
  client = null;
  return null;
}

function propertyId(): string | null {
  return process.env.GA_PROPERTY_ID ?? null;
}

type Row = { dimensionValues?: { value?: string | null }[]; metricValues?: { value?: string | null }[] };

function rowToMap(row: Row, dims: number, metrics: number): { dims: string[]; metrics: number[] } {
  const d = (row.dimensionValues ?? []).slice(0, dims).map((v) => v.value ?? '');
  const m = (row.metricValues ?? []).slice(0, metrics).map((v) => Number(v.value ?? 0));
  return { dims: d, metrics: m };
}

type ReportParams = {
  dateRanges: { startDate: string; endDate: string }[];
  dimensions: { name: string }[];
  metrics: { name: string }[];
  orderBys?: { metric: { metricName: string }; desc: boolean }[];
  limit?: number;
};

async function runReport(params: ReportParams): Promise<Row[]> {
  const c = getClient();
  const pid = propertyId();
  if (!c || !pid) return [];
  const [resp] = await c.runReport({ property: `properties/${pid}`, ...params });
  return (resp.rows ?? []) as Row[];
}

function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function fmtPct(value: number): string {
  return `${(value * 100).toFixed(1).replace('.', ',')}%`;
}

export async function getGa4Dashboard(): Promise<Ga4Report> {
  const base: Ga4Report = {
    configured: true,
    last7: [],
    last30: [],
    realtime: { activeUsers: null, eventCount: null },
    trend: [],
    topPages: [],
    channels: [],
    devices: [],
    countries: [],
  };

  if (!propertyId()) {
    return { ...base, configured: false, error: 'GA_PROPERTY_ID no configurado' };
  }
  if (!getClient()) {
    return { ...base, configured: false, error: 'Credenciales de Google no configuradas' };
  }

  const range7 = [{ startDate: '7daysAgo', endDate: 'yesterday' }];
  const range30 = [{ startDate: '30daysAgo', endDate: 'yesterday' }];
  const coreMetrics = [
    { name: 'totalUsers' },
    { name: 'newUsers' },
    { name: 'sessions' },
    { name: 'screenPageViews' },
    { name: 'engagementRate' },
    { name: 'averageSessionDuration' },
    { name: 'bounceRate' },
  ];
  const coreDims: { name: string }[] = [];

  try {
    const [r7, r30] = await Promise.all([
      runReport({ dateRanges: range7, dimensions: coreDims, metrics: coreMetrics }),
      runReport({ dateRanges: range30, dimensions: coreDims, metrics: coreMetrics }),
    ]);

    const pick = (rows: Row[], metric: string): number | string => {
      const rows7 = rows;
      if (rows7.length === 0) return 0;
      const idx = coreMetrics.findIndex((m) => m.name === metric);
      const val = Number(rows7[0]?.metricValues?.[idx]?.value ?? 0);
      if (metric === 'engagementRate') return fmtPct(val);
      if (metric === 'bounceRate') return fmtPct(val);
      if (metric === 'averageSessionDuration') return fmtDuration(val);
      return Math.round(val).toLocaleString('es-AR');
    };

    const metricLabels: Record<string, string> = {
      totalUsers: 'Usuarios',
      newUsers: 'Usuarios nuevos',
      sessions: 'Sesiones',
      screenPageViews: 'Vistas de página',
      engagementRate: 'Tasa de interacción',
      averageSessionDuration: 'Duración media',
      bounceRate: 'Rebote',
    };

    base.last7 = coreMetrics.map((m) => ({
      label: metricLabels[m.name],
      value: pick(r7, m.name),
    }));
    base.last30 = coreMetrics.map((m) => ({
      label: metricLabels[m.name],
      value: pick(r30, m.name),
    }));

    const trendRows = await runReport({
      dateRanges: range30,
      dimensions: [{ name: 'date' }],
      metrics: [
        { name: 'totalUsers' },
        { name: 'sessions' },
        { name: 'screenPageViews' },
      ],
      orderBys: [{ metric: { metricName: 'date' }, desc: false }],
    });
    base.trend = trendRows.map((r) => {
      const { dims, metrics } = rowToMap(r, 1, 3);
      const raw = dims[0] ?? '';
      const date = raw.length === 8 ? `${raw.slice(6, 8)}/${raw.slice(4, 6)}` : raw;
      return { date, users: metrics[0], sessions: metrics[1], views: metrics[2] };
    });

    const [pages, channels, devices, countries] = await Promise.all([
      runReport({
        dateRanges: range30,
        dimensions: [{ name: 'pagePath' }, { name: 'pageTitle' }],
        metrics: [{ name: 'screenPageViews' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
        limit: 15,
      }),
      runReport({
        dateRanges: range30,
        dimensions: [{ name: 'sessionDefaultChannelGroup' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
        limit: 8,
      }),
      runReport({
        dateRanges: range30,
        dimensions: [{ name: 'deviceCategory' }],
        metrics: [{ name: 'sessions' }, { name: 'totalUsers' }],
        limit: 5,
      }),
      runReport({
        dateRanges: range30,
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'totalUsers' }, { name: 'sessions' }],
        orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
        limit: 10,
      }),
    ]);

    base.topPages = pages.map((r) => {
      const { dims, metrics } = rowToMap(r, 2, 2);
      const title = dims[1]?.trim();
      return {
        path: dims[0] ?? '',
        title: title && title !== '(not set)' ? title : dims[0] ?? '',
        views: metrics[0],
        users: metrics[1],
      };
    });
    base.channels = channels.map((r) => {
      const { dims, metrics } = rowToMap(r, 1, 2);
      return { name: dims[0] ?? '', sessions: metrics[0], users: metrics[1] };
    });
    base.devices = devices.map((r) => {
      const { dims, metrics } = rowToMap(r, 1, 2);
      return { name: dims[0] ?? '', sessions: metrics[0], users: metrics[1] };
    });
    base.countries = countries.map((r) => {
      const { dims, metrics } = rowToMap(r, 1, 2);
      return { name: dims[0] ?? '', users: metrics[0], sessions: metrics[1] };
    });

    try {
      const c = getClient();
      const pid = propertyId();
      if (c && pid) {
        const [rt] = await c.runRealtimeReport({
          property: `properties/${pid}`,
          metrics: [{ name: 'activeUsers' }, { name: 'eventCount' }],
        });
        if (rt.rows?.length) {
          base.realtime = {
            activeUsers: Number(rt.rows[0].metricValues?.[0]?.value ?? 0),
            eventCount: Number(rt.rows[0].metricValues?.[1]?.value ?? 0),
          };
        }
      }
    } catch {
      base.realtime = { activeUsers: null, eventCount: null };
    }

    return base;
  } catch (err) {
    return {
      ...base,
      configured: false,
      error: err instanceof Error ? err.message : 'Error consultando GA4',
    };
  }
}