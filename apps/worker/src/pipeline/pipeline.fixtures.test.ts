import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Kysely } from 'kysely';
import pino from 'pino';
import type { DB, ProductSnapshot, StoreSlug } from '@precios/shared';
import type { ScraperAdapter } from '@precios/scraper-core';
import { IngestPipeline } from './pipeline.ts';
import { parseListing as parseDia } from '@precios/adapters-dia';
import { parseListing as parseCarrefour } from '@precios/adapters-carrefour';

const DIA_FIXTURE = fileURLToPath(
  new URL(
    '../../../../packages/adapters/dia/tests/fixtures/dia-listing-arroz.html',
    import.meta.url,
  ),
);
const C4_FIXTURE = fileURLToPath(
  new URL(
    '../../../../packages/adapters/carrefour/tests/fixtures/carrefour-category-arroz.html',
    import.meta.url,
  ),
);

type Row = Record<string, unknown>;

const CONFLICT_KEYS: Record<string, string[]> = {
  store_sku: ['store_id', 'external_id'],
  match_link: ['store_sku_id'],
  price_record: ['store_sku_id', 'captured_at', 'list_or_promo'],
  product: ['slug'],
};

function normValue(v: unknown): unknown {
  if (v instanceof Date) return v.getTime();
  return v;
}

function bare(col: string): string {
  return col.split('.').pop()!;
}

function resolveCol(row: Row, col: string, table: string): unknown {
  return row[bare(col)] ?? row[`${table}.${bare(col)}`];
}

class SelectBuilder {
  private preds: Array<[string, unknown]> = [];
  private order?: { col: string; dir: string };
  private limitN?: number;
  private join?: { table: string; left: string; right: string };

  constructor(
    private readonly db: FakeKysely,
    private readonly table: string,
  ) {}

  select(): this {
    return this;
  }

  innerJoin(table2: string, left: string, right: string): this {
    this.join = { table: table2, left, right };
    return this;
  }

  where(col: string, _op: string, val: unknown): this {
    this.preds.push([col, val]);
    return this;
  }

  orderBy(col: string, dir: 'asc' | 'desc'): this {
    this.order = { col, dir };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  private rows(): Row[] {
    let out = [...(this.db.tables.get(this.table) ?? [])];
    if (this.join) {
      const { table: t2, left, right } = this.join;
      const other = this.db.tables.get(t2) ?? [];
      const combined: Row[] = [];
      for (const leftRow of out) {
        for (const rightRow of other) {
          const lv = normValue(resolveCol(leftRow, left, this.table));
          const rv = normValue(resolveCol(rightRow, right, t2));
          if (lv === rv) combined.push({ ...rightRow, ...leftRow });
        }
      }
      out = combined;
    }
    for (const [col, val] of this.preds) {
      out = out.filter((r) => normValue(resolveCol(r, col, this.table)) === normValue(val));
    }
    if (this.order) {
      const { col, dir } = this.order;
      out.sort((a, b) => {
        const av = resolveCol(a, col, this.table) ?? 0;
        const bv = resolveCol(b, col, this.table) ?? 0;
        const cmp =
          typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av).localeCompare(String(bv));
        return dir === 'desc' ? -cmp : cmp;
      });
    }
    if (this.limitN !== undefined) out = out.slice(0, this.limitN);
    return out;
  }

  async executeTakeFirst(): Promise<Row | undefined> {
    return this.rows()[0];
  }

  async executeTakeFirstOrThrow(): Promise<Row> {
    const row = this.rows()[0];
    if (!row) throw new Error(`fake-db: fila no encontrada en ${this.table}`);
    return row;
  }

  async execute(): Promise<Row[]> {
    return this.rows();
  }
}

interface ConflictApi {
  column(_col: string): { doUpdateSet(set: Row): void; doNothing(): void };
  columns(_cols: string[]): { doUpdateSet(set: Row): void; doNothing(): void };
}

class InsertBuilder {
  private row: Row | null = null;
  private retCol?: string;
  private upsertSet: Row | null = null;
  private skipOnConflict = false;

  constructor(
    private readonly db: FakeKysely,
    private readonly table: string,
  ) {}

  values(row: Row): this {
    this.row = row;
    return this;
  }

  returning(col: string): this {
    this.retCol = col;
    return this;
  }

  onConflict(cb: (oc: ConflictApi) => void): this {
    const action = (fn: () => void) => fn();
    cb({
      column: () => ({
        doUpdateSet: (set: Row) => action(() => (this.upsertSet = set)),
        doNothing: () => action(() => (this.skipOnConflict = true)),
      }),
      columns: () => ({
        doUpdateSet: (set: Row) => action(() => (this.upsertSet = set)),
        doNothing: () => action(() => (this.skipOnConflict = true)),
      }),
    });
    return this;
  }

  private apply(): number | null {
    const row = this.row!;
    const table = this.db.tables.get(this.table)!;
    const keys = CONFLICT_KEYS[this.table] ?? [];
    let existing: Row | undefined;
    if (keys.length > 0) {
      existing = table.find((candidate) =>
        keys.every((k) => normValue(candidate[k]) === normValue(row[k])),
      );
    }
    if (existing && this.skipOnConflict) return Number(existing.id ?? 0);
    if (existing && this.upsertSet) {
      Object.assign(existing, this.upsertSet);
      return existing.id !== undefined ? Number(existing.id) : null;
    }
    const full: Row = { ...row };
    if (this.table === 'store_sku' || this.table === 'product' || this.table === 'match_link') {
      if (full.id === undefined) full.id = this.db.nextId(this.table);
    }
    if (this.table === 'product' && full.created_at === undefined) {
      full.created_at = new Date();
      full.updated_at = new Date();
    }
    table.push(full);
    return full.id !== undefined ? Number(full.id) : null;
  }

  async executeTakeFirstOrThrow(): Promise<Row> {
    const id = this.apply();
    if (id === null) throw new Error(`fake-db: insert sin id en ${this.table}`);
    return { [this.retCol!]: id };
  }

  async execute(): Promise<void> {
    this.apply();
  }
}

class UpdateBuilder {
  private set_: Row = {};
  private preds: Array<[string, unknown]> = [];

  constructor(
    private readonly db: FakeKysely,
    private readonly table: string,
  ) {}

  set(obj: Row): this {
    this.set_ = obj;
    return this;
  }

  where(col: string, _op: string, val: unknown): this {
    this.preds.push([col, val]);
    return this;
  }

  async execute(): Promise<void> {
    const table = this.db.tables.get(this.table)!;
    for (const row of table) {
      const matches = this.preds.every(([col, val]) => normValue(row[col]) === normValue(val));
      if (matches) Object.assign(row, this.set_);
    }
  }
}

class FakeKysely {
  readonly tables = new Map<string, Row[]>([
    ['store', []],
    ['category', []],
    ['product', []],
    ['store_sku', []],
    ['match_link', []],
    ['price_record', []],
    ['run_report', []],
  ]);
  private sequences = new Map<string, number>();

  selectFrom(table: string): SelectBuilder {
    return new SelectBuilder(this, table);
  }

  insertInto(table: string): InsertBuilder {
    return new InsertBuilder(this, table);
  }

  updateTable(table: string): UpdateBuilder {
    return new UpdateBuilder(this, table);
  }

  nextId(table: string): number {
    const n = (this.sequences.get(table) ?? 0) + 1;
    this.sequences.set(table, n);
    return n;
  }
}

class FixtureAdapter implements ScraperAdapter {
  constructor(
    readonly storeSlug: StoreSlug,
    private readonly snapshots: ProductSnapshot[],
  ) {}

  async *discover(): AsyncGenerator<never, void, void> {}

  async *scrapeCatalog(): AsyncGenerator<ProductSnapshot, void, void> {
    for (const snap of this.snapshots) yield snap;
  }

  async scrapeProduct(): Promise<ProductSnapshot | null> {
    return null;
  }
}

const logger = pino({ level: 'silent' });

const BROWSER = {} as never;

function seedStores(db: FakeKysely): void {
  db.tables.set('store', [
    {
      id: 1,
      slug: 'dia',
      base_url: 'https://diaonline.supermercadosdia.com.ar/',
      config: {},
      is_active: true,
    },
    {
      id: 2,
      slug: 'carrefour',
      base_url: 'https://www.carrefour.com.ar/',
      config: {},
      is_active: true,
    },
  ]);
}

async function runAdapter(
  db: FakeKysely,
  adapter: ScraperAdapter,
  _storeId: number,
): Promise<Awaited<ReturnType<IngestPipeline['run']>>> {
  const pipeline = new IngestPipeline(db as unknown as Kysely<DB>, logger);
  return pipeline.run(adapter, {
    runId: `run-${adapter.storeSlug}-${Math.random().toString(36).slice(2, 8)}`,
    correlationId: 'test-correlation',
    browser: BROWSER,
    signal: new AbortController().signal,
  });
}

describe('pipeline de ingesta con snapshots de fixtures reales (fake-db)', () => {
  it('procesa, valida checksum y persiste snapshots de DIA sin errores', async () => {
    const db = new FakeKysely();
    seedStores(db);

    const snaps = parseDia(readFileSync(DIA_FIXTURE, 'utf8'));
    expect(snaps.length).toBeGreaterThanOrEqual(8);

    const duplicada = { ...snaps[0]!, price: { ...snaps[0]!.price } };

    const eanInvalido: ProductSnapshot = {
      ...snaps[0]!,
      externalId: 'test-ean-malo',
      ean: '7791120037550',
      url: snaps[0]!.url,
      capturedAt: new Date().toISOString(),
    };

    const adapter = new FixtureAdapter('dia', [...snaps, duplicada, eanInvalido]);
    const summary = await runAdapter(db, adapter, 1);

    expect(summary.status).toBe('success');
    expect(summary.captured).toBe(snaps.length + 1);
    expect(summary.rejected).toBe(0);
    expect(summary.quarantined).toBe(false);

    const skus = db.tables.get('store_sku')!;
    expect(skus.length).toBe(snaps.length + 1);
    expect(skus.every((s) => s.store_id === 1)).toBe(true);

    const skuMalo = skus.find((s) => s.external_id === 'test-ean-malo');
    expect(skuMalo).toBeDefined();
    expect(skuMalo!.declared_ean).toBeNull();

    const prices = db.tables.get('price_record')!;
    expect(prices.length).toBe(snaps.length + 1);
    expect(prices.every((p) => Number(p.price_amount) > 0)).toBe(true);

    const reports = db.tables.get('run_report')!;
    expect(reports.length).toBe(1);
    expect(reports[0]!.status).toBe('success');
    expect(reports[0]!.skus_captured).toBe(snaps.length + 1);
  });

  it('deduplica por (sku, captured_at, list_or_promo) dentro y entre corridas', async () => {
    const db = new FakeKysely();
    seedStores(db);

    const primera = parseCarrefour(readFileSync(C4_FIXTURE, 'utf8'));
    await runAdapter(db, new FixtureAdapter('carrefour', primera), 2);
    const trasPrimera = db.tables.get('price_record')!.length;
    expect(trasPrimera).toBe(primera.length);

    const segunda = parseCarrefour(readFileSync(C4_FIXTURE, 'utf8'));
    const duplicada = { ...segunda[0]!, price: { ...segunda[0]!.price } };
    await runAdapter(db, new FixtureAdapter('carrefour', [...segunda, duplicada]), 2);

    expect(db.tables.get('price_record')!.length).toBe(trasPrimera * 2);
  });

  it('vincula por EAN el mismo producto entre DIA y Carrefour', async () => {
    const db = new FakeKysely();
    seedStores(db);

    await runAdapter(db, new FixtureAdapter('dia', parseDia(readFileSync(DIA_FIXTURE, 'utf8'))), 1);
    await runAdapter(
      db,
      new FixtureAdapter('carrefour', parseCarrefour(readFileSync(C4_FIXTURE, 'utf8'))),
      2,
    );

    const links = db.tables.get('match_link')!;
    const products = db.tables.get('product')!;
    const skus = db.tables.get('store_sku')!;
    expect(products.length).toBeGreaterThan(0);
    expect(links.length).toBe(skus.length);

    const bySkuStore = new Map<number, number>(
      skus.map((s) => [Number(s.id), Number(s.store_id)] as const),
    );
    const sharedProducts = new Map<number, Set<number>>();
    for (const link of links) {
      const productId = Number(link.product_id);
      const storeId = bySkuStore.get(Number(link.store_sku_id))!;
      const stores = sharedProducts.get(productId) ?? new Set<number>();
      stores.add(storeId);
      sharedProducts.set(productId, stores);
    }
    const multiStore = [...sharedProducts.values()].filter((stores) => stores.size >= 2);
    expect(multiStore.length).toBeGreaterThanOrEqual(3);

    const eanLinks = links.filter((l) => l.method === 'ean');
    expect(eanLinks.length).toBeGreaterThanOrEqual(3);
  });

  it('marca como sospechosa una variación de precio mayor al 80%', async () => {
    const db = new FakeKysely();
    seedStores(db);
    const base = parseDia(readFileSync(DIA_FIXTURE, 'utf8'));

    await runAdapter(db, new FixtureAdapter('dia', base), 1);

    const infladas = base.map((snap, i) => ({
      ...snap,
      capturedAt: new Date(Date.now() + 60_000 + i).toISOString(),
      price: { ...snap.price, amount: snap.price.amount * 10 },
    }));
    const summary = await runAdapter(db, new FixtureAdapter('dia', infladas), 1);
    expect(summary.status).toBe('success');

    const prices = db.tables.get('price_record')!;
    const sospechosos = prices.filter((p) => p.is_suspect === true);
    expect(sospechosos.length).toBe(infladas.length);
    const normales = prices.filter((p) => p.is_suspect === false);
    expect(normales.length).toBe(base.length);
  });

  it('marca como pending_review un match por EAN con descripción genérica (yerba Amanda)', async () => {
    const db = new FakeKysely();
    seedStores(db);

    const branded: ProductSnapshot = {
      externalId: 'dia-amanda-1kg',
      url: 'https://diaonline.supermercadosdia.com.ar/product/amanda',
      rawDescription: 'Yerba Mate Amanda Tradicional 1 Kg.',
      brand: 'Amanda',
      ean: '7792710000175',
      categoryPath: ['almacen'],
      unitLabel: '1 kg',
      price: { amount: 4989, listOrPromo: 'list' },
      capturedAt: new Date().toISOString(),
    };
    const generica: ProductSnapshot = {
      externalId: 'c4-yerba-tradicional',
      url: 'https://www.carrefour.com.ar/product/yerba',
      rawDescription: 'YERBA TRADICIONAL 1kg',
      brand: undefined,
      ean: '7792710000175',
      categoryPath: ['almacen'],
      price: { amount: 4490, listOrPromo: 'list' },
      capturedAt: new Date().toISOString(),
    };

    await runAdapter(db, new FixtureAdapter('dia', [branded]), 1);
    await runAdapter(db, new FixtureAdapter('carrefour', [generica]), 2);

    const links = db.tables.get('match_link')!;
    const carrefour = links.find((l) =>
      db.tables
        .get('store_sku')!
        .find((s) => s.id === l.store_sku_id && s.external_id === 'c4-yerba-tradicional'),
    );
    expect(carrefour).toBeDefined();
    expect(carrefour!.method).toBe('ean');
    expect(carrefour!.status).toBe('pending_review');
  });
});
