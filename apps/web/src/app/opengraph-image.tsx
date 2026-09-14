import { ImageResponse } from 'next/og';
import { OG_COLORS, OgShell, loadBrandAssets } from '@/lib/og-brand';

export const alt = 'Precios Tandil — compará precios de supermercados';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** OG image por defecto del sitio (home, categorías, ofertas). */
export default async function OpengraphImage() {
  const { logo, fonts } = await loadBrandAssets();

  return new ImageResponse(
    <OgShell logo={logo}>
      <div
        style={{
          maxWidth: 1020,
          fontSize: 74,
          fontWeight: 800,
          lineHeight: 1.1,
          letterSpacing: '-0.02em',
          color: OG_COLORS.white,
        }}
      >
        Compará precios en supermercados de Tandil
      </div>
      <div
        style={{
          marginTop: 28,
          fontSize: 34,
          fontWeight: 400,
          color: OG_COLORS.muted,
        }}
      >
        Actualización diaria &middot; historial de precios &middot; mejores oportunidades
      </div>
    </OgShell>,
    {
      ...size,
      fonts,
    },
  );
}
