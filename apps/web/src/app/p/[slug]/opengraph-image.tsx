import { ImageResponse } from 'next/og';

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
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8080/api/v1'}/products/${slug}`,
      { cache: 'no-store' },
    );
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

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: '#0d6e3c',
        color: '#ffffff',
        padding: 64,
        fontSize: 48,
      }}
    >
      <div style={{ fontSize: 28, opacity: 0.85, marginBottom: 24 }}>Precios Tandil</div>
      <div style={{ fontWeight: 700, textAlign: 'center', maxWidth: 1000 }}>{name}</div>
      <div style={{ marginTop: 32, fontSize: price ? 72 : 36 }}>
        {price ? `Desde ${price}` : 'Compará precios en Tandil'}
      </div>
    </div>,
    size,
  );
}
