import { ImageResponse } from 'next/og';

export const alt = 'Precios Tandil — compará precios de supermercados';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** OG image por defecto del sitio (home, categorías, ofertas). */
export default async function OpengraphImage() {
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
      <div style={{ fontWeight: 700, textAlign: 'center', maxWidth: 1000 }}>
        Compará precios en supermercados de Tandil
      </div>
      <div style={{ marginTop: 24, fontSize: 32, opacity: 0.9 }}>
        Carrefour · Vea · Día · Monarca · Comerciante Maxi · Coto
      </div>
    </div>,
    size,
  );
}
