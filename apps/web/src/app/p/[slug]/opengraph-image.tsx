import { ImageResponse } from 'next/og';
import { OG_COLORS, OgShell, loadBrandAssets } from '@/lib/og-brand';
import { siteUrl } from '@/lib/site';

export const alt = 'Precio en supermercados de Tandil';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * T063 — OG image dinámica por producto: nombre + mejor precio actual
 * renderizado sobre tarjeta con marca del sitio.
 */
export default async function OpengraphImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  let name = slug;
  let price: string | null = null;
  try {
    const res = await fetch(`${siteUrl('/')}api/v1/products/${slug}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (res.ok) {
      const data = (await res.json()) as {
        name: string;
        summary?: { best_price?: number | null } | null;
      };
      name = data.name;
      if (data.summary?.best_price !== null && data.summary?.best_price !== undefined) {
        price = new Intl.NumberFormat('es-AR', {
          style: 'currency',
          currency: 'ARS',
        }).format(data.summary.best_price);
      }
    }
  } catch {
    // fallback al slug
  }

  const { logo, fonts } = await loadBrandAssets();
  const shortName = name.length > 52 ? `${name.slice(0, 52).trim()}…` : name;

  return new ImageResponse(
    <OgShell logo={logo}>
      <div
        style={{
          maxWidth: 1040,
          fontSize: 66,
          fontWeight: 800,
          lineHeight: 1.12,
          letterSpacing: '-0.02em',
          color: OG_COLORS.white,
        }}
      >
        {shortName}
      </div>
      <div style={{ marginTop: 36, display: 'flex' }}>
        {price ? (
          <div
            style={{
              display: 'inline-flex',
              background: OG_COLORS.yellow,
              color: OG_COLORS.bg,
              fontWeight: 800,
              fontSize: 56,
              borderRadius: 999,
              padding: '18px 44px',
            }}
          >
            Desde {price}
          </div>
        ) : (
          <div style={{ fontSize: 34, fontWeight: 400, color: OG_COLORS.muted }}>
            Compará precios en supermercados de Tandil
          </div>
        )}
      </div>
    </OgShell>,
    {
      ...size,
      fonts,
    },
  );
}
