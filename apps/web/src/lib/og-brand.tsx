import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReactNode } from 'react';

export const OG_COLORS = {
  bg: '#0b0d12',
  border: '#2a3040',
  yellow: '#FFB909',
  white: '#f8fafc',
  muted: '#a9b1c0',
  faint: '#6f7791',
} as const;

type OgFontWeight = 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
export type OgBrandAssets = { logo: string | null; fonts: OgFont[] };
type OgFont = {
  name: string;
  data: Buffer;
  style: 'normal';
  weight: OgFontWeight;
};

const read = (path: string) => readFile(path).catch(() => null);

export async function loadBrandAssets(): Promise<OgBrandAssets> {
  const cwd = process.cwd();
  const [logo, regular, bold, extraBold] = await Promise.all([
    read(join(cwd, 'public', 'sigma-market.png')),
    read(join(cwd, 'assets', 'fonts', 'Montserrat-Regular.ttf')),
    read(join(cwd, 'assets', 'fonts', 'Montserrat-Bold.ttf')),
    read(join(cwd, 'assets', 'fonts', 'Montserrat-ExtraBold.ttf')),
  ]);

  const entries = [
    { weight: 400 as const, data: regular },
    { weight: 700 as const, data: bold },
    { weight: 800 as const, data: extraBold },
  ];

  return {
    logo: logo ? `data:image/png;base64,${logo.toString('base64')}` : null,
    fonts: entries.flatMap((entry) =>
      entry.data
        ? [{ name: 'Montserrat', data: entry.data, style: 'normal' as const, weight: entry.weight }]
        : [],
    ),
  };
}

const STORES = 'Carrefour · Vea · Día · Monarca · Golopolis · Cooperativa Obrera';

export function OgHeader({ logo }: { logo: string | null }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        {logo ? (
          <img
            src={logo}
            width={52}
            height={52}
            style={{ borderRadius: 14, objectFit: 'cover' }}
            alt=""
          />
        ) : null}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 30 }}>
          <span style={{ fontWeight: 800, color: OG_COLORS.white }}>Precios</span>
          <span style={{ fontWeight: 800, color: OG_COLORS.yellow }}>Tandil</span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: 17,
          color: OG_COLORS.muted,
          border: `1px solid ${OG_COLORS.border}`,
          borderRadius: 999,
          padding: '10px 18px',
        }}
      >
        <span style={{ fontWeight: 700, color: OG_COLORS.yellow }}>Sigma</span>
        <span>&times;</span>
        <span>Tandil Alerta</span>
      </div>
    </div>
  );
}

export function OgFooter() {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        borderTop: `1px solid ${OG_COLORS.border}`,
        paddingTop: 26,
      }}
    >
      <div style={{ fontSize: 24, color: OG_COLORS.muted, fontWeight: 500 }}>{STORES}</div>
      <div style={{ fontSize: 18, color: OG_COLORS.faint, fontWeight: 400 }}>
        Tecnología de análisis impulsada por Sigma Tecnologías · Difundido por Tandil Alerta
      </div>
    </div>
  );
}

export function OgShell({ logo, children }: { logo: string | null; children: ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Montserrat',
        background: `radial-gradient(1200px 500px at 82% -5%, rgba(255,185,9,0.16), rgba(255,185,9,0) 60%), linear-gradient(160deg, ${OG_COLORS.bg} 0%, #131722 55%, #0e1117 100%)`,
        color: OG_COLORS.white,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          padding: '56px 72px',
        }}
      >
        <OgHeader logo={logo} />
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
        >
          {children}
        </div>
        <OgFooter />
      </div>
    </div>
  );
}
