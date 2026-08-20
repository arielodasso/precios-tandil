# Contrato ScraperAdapter ↔ Pipeline — Precios Tandil

Todo supermercado se integra mediante un adaptador que implementa este
contrato (Constitución VII). El runtime común (`packages/scraper-core`) provee
HTTP resiliente, validación y persistencia; el adaptador SOLO conoce su sitio.

## Interfaz (TypeScript)

```ts
export interface AdapterContext {
  runId: string;              // correlation-id de la corrida
  logger: Logger;             // pino con correlation-id inyectado
  http: ResilientHttpClient;  // UA rotation + proxy pool + backoff + circuit breaker
  browser: BrowserContext;    // Playwright context preconfigurado
  signal: AbortSignal;        // cancelación por ventana horaria/cuarentena
}

export interface ProductSnapshot {
  externalId: string;         // id del producto en la tienda (estable)
  url: string;                // URL canónica del producto
  rawDescription: string;     // descripción textual original, sin limpiar
  ean?: string;               // EAN-13 si el sitio lo expone
  brand?: string;
  categoryPath?: string[];    // taxonomía propia de la tienda
  unitLabel?: string;         // 'x 1 kg' | '500 ml' | 'un'
  price: {
    amount: number;           // > 0, en ARS
    listOrPromo: 'list' | 'promo';
    promoLabel?: string;      // '2x1', '-25%', etc.
    unitPrice?: number;       // precio por unidad si la tienda lo publica
  };
  imageUrl?: string;
  capturedAt: string;         // ISO-8601 UTC
}

export interface ScraperAdapter {
  readonly storeSlug: string; // debe coincidir con store.slug en DB

  /** Descubre URLs/listados a recorrer. Opcional si la tienda expone sitemap/API. */
  discover(ctx: AdapterContext): AsyncIterable<ListingRef>;

  /** Extrae un ProductSnapshot desde una página de producto. */
  scrapeProduct(ref: ListingRef, ctx: AdapterContext): Promise<ProductSnapshot | null>;

  /** Recorre el catálogo completo emitiendo snapshots. */
  scrapeCatalog(ctx: AdapterContext): AsyncIterable<ProductSnapshot>;
}
```

## Responsabilidades

| Concern | Dueño |
|---|---|
| Selectores/parseo del sitio | Adaptador |
| UA rotation, proxy, backoff exponencial+jitter, circuit breaker | Runtime (`ResilientHttpClient`) |
| Validación de snapshot (precio>0, ARS, URL válida, EAN checksum) | Runtime (pre-persistencia) |
| Dedupe intra-corrida, append-only en DB | Pipeline worker |
| Normalización léxica y matching EAN/semántico | `packages/normalizer` |
| Reporte de corrida y cuarentena | Worker scheduler |

## Reglas obligatorias para adaptadores

1. NUNCA escribir a DB directamente: solo emitir `ProductSnapshot`.
2. Tolerar fallos por ítem: un producto roto no aborta `scrapeCatalog`
   (log warn + continue).
3. Respetar `ctx.signal`: al abortar, finalizar limpio y devolver lo recolectado.
4. Concurrencia ≤ 2 páginas simultáneas por sitio; delays configurables en
   `store.config` (default 800–2000 ms aleatorio entre navegaciones).
5. Sin datos personales ni interacciones de compra; solo lectura pública.
6. Cada cambio de selectores vive SOLO en su package de adaptador con tests
   contra fixture HTML congelada.

## Validación pre-persistencia (rechazo con causa)

- `price.amount <= 0` → reject `invalid_price`
- moneda no-ARS → reject `invalid_currency`
- URL no pertenece al dominio de la tienda → reject `invalid_source_url`
- EAN con checksum inválido → se descarta EAN (no el snapshot)
- variación > 80 % vs último precio válido → persistir con `is_suspect=true`

## Cuarentena (circuit breaker)

- 3 fallos consecutivos de página o error HTTP dominante → `quarantined=true`.
- Salida: ventana siguiente (próxima noche) o retry manual admin.
- Mientras esté en cuarentena, el scheduler salta la tienda y el reporte lo
  indica; los precios existentes NO se tocan.
