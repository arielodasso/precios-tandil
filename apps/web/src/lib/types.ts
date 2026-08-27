export interface SearchResultItem {
  slug: string;
  name: string;
  brand?: string | null;
  best_price: number | null;
  stores_count?: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
  next_cursor: string | null;
}

export interface ProductOffer {
  store: string;
  store_name: string;
  price: number | null;
  unit_price: number | null;
  promo: boolean;
  source_url: string;
  captured_at: string | null;
  freshness_hours: number | null;
  is_stale: boolean;
}

export interface ProductSummary {
  best_store: string | null;
  best_price: number | null;
  worst_price: number | null;
  spread_pct: number | null;
  stores_count: number;
  pct_change_7d: number | null;
  min_30d: number | null;
  near_min_90d: boolean;
}

export interface ProductDetail {
  slug: string;
  name: string;
  brand: string | null;
  ean: number | null;
  unit: { amount: number; type: string } | null;
  category: string | null;
  image_url: string | null;
  offers: ProductOffer[];
  summary: ProductSummary;
  deal_badge: 'gold' | 'green' | null;
  stale_notice?: string;
}

export interface HistoryResponse {
  product_slug: string;
  window: '30' | '90' | 'all';
  insufficient_history: boolean;
  series: Array<{ date: string; min_price: number; avg_price: number | null }>;
  stats: {
    min_window: number | null;
    max_window: number | null;
    pct_change_24h: number | null;
    pct_change_7d: number | null;
    avg_30d: number | null;
    near_min_90d: boolean | null;
  };
}

export interface DealItem {
  slug: string;
  name: string;
  image_url: string | null;
  store_slug: string | null;
  price: number | null;
  discount_pct: number;
  badge: string;
  published_at: string;
  expires_at: string | null;
  offers: CardOffer[];
}

/** Oferta individual (fuente) para mostrar dentro de una tarjeta de producto. */
export interface CardOffer {
  store: string;
  store_name: string;
  price: number | null;
  source_url: string | null;
}
