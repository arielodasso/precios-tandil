import type { Generated } from 'kysely';
import type { StoreConfig, StoreSlug } from './types/store.ts';
import type { ListOrPromo, UnitType } from './types/snapshot.ts';

export interface StoreRow {
  id: Generated<number>;
  slug: StoreSlug;
  name: string;
  base_url: string;
  adapter_id: string;
  is_active: boolean;
  freshness_sla: string;
  config: StoreConfig;
  created_at: Generated<Date>;
}

export interface CategoryRow {
  id: Generated<number>;
  slug: string;
  name: string;
  parent_id: number | null;
  path: string;
}

export interface ProductRow {
  id: Generated<number>;
  slug: string;
  canonical_name: string;
  brand: string | null;
  ean: string | null;
  unit_amount: string | null;
  unit_type: UnitType | null;
  image_url: string | null;
  category_id: number | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface StoreSkuRow {
  id: Generated<number>;
  store_id: number;
  external_id: string;
  url: string;
  raw_description: string;
  declared_ean: string | null;
  unit_label: string | null;
  last_seen_at: Date | null;
  is_active: boolean;
}

export type MatchMethod = 'ean' | 'semantic' | 'manual';
export type MatchStatus = 'auto' | 'pending_review' | 'confirmed' | 'rejected';

export interface MatchLinkRow {
  id: Generated<number>;
  store_sku_id: number;
  product_id: number;
  method: MatchMethod;
  score: string | null;
  status: MatchStatus;
  decided_by: string | null;
  decided_at: Date | null;
  created_at: Generated<Date>;
}

export interface PriceRecordRow {
  id: Generated<string>;
  store_sku_id: number;
  price_amount: string;
  currency: string;
  list_or_promo: ListOrPromo;
  unit_price: string | null;
  source_url: string;
  captured_at: Date;
  run_id: string;
  is_suspect: boolean;
}

export interface PriceAggregateRow {
  product_id: number;
  best_store_id: number | null;
  best_price: string | null;
  best_captured_at: Date | null;
  min_30d: string | null;
  min_90d: string | null;
  min_all_time: string | null;
  avg_30d: string | null;
  pct_change_7d: string | null;
  pct_change_24h: string | null;
  stores_count: number | null;
  refreshed_at: Date;
}

export type RunStatus = 'running' | 'success' | 'partial' | 'failed';

export interface RunReportRow {
  run_id: string;
  store_id: number;
  started_at: Date;
  finished_at: Date | null;
  status: RunStatus;
  skus_captured: number;
  skus_rejected: number;
  http_errors: number;
  quarantined: boolean;
  errors_sample: unknown[];
  correlation_id: string;
}

export interface DealCandidateRow {
  id: Generated<number>;
  product_id: number;
  detected_at: Date;
  discount_pct: string;
  evidence: unknown;
  status: 'pending' | 'published' | 'rejected';
  rejected_until: Date | null;
}

export interface DealPublicationRow {
  id: Generated<number>;
  candidate_id: number;
  published_by: string;
  published_at: Generated<Date>;
  badge: string;
  expires_at: Date | null;
}

export interface AdminTokenRow {
  id: Generated<number>;
  label: string;
  token_hash: string;
  role: 'operator' | 'admin';
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface DB {
  store: StoreRow;
  category: CategoryRow;
  product: ProductRow;
  store_sku: StoreSkuRow;
  match_link: MatchLinkRow;
  price_record: PriceRecordRow;
  price_aggregate: PriceAggregateRow;
  run_report: RunReportRow;
  deal_candidate: DealCandidateRow;
  deal_publication: DealPublicationRow;
  admin_token: AdminTokenRow;
}
