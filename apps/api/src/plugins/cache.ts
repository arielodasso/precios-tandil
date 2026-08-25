import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import Redis from 'ioredis';

export interface CacheStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
}

class MemoryCache implements CacheStore {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<string | null> {
    const hit = this.entries.get(key);
    if (!hit) return null;
    if (Date.now() > hit.expiresAt) {
      this.entries.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
    if (this.entries.size > 5000) {
      const now = Date.now();
      for (const [k, v] of this.entries) {
        if (now > v.expiresAt) this.entries.delete(k);
      }
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    cache: CacheStore;
  }
}

let redisClient: Redis | null = null;

export function createCacheStore(redisUrl?: string): CacheStore {
  if (!redisUrl) return new MemoryCache();
  redisClient = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  return {
    async get(key) {
      try {
        return await redisClient!.get(key);
      } catch {
        return null;
      }
    },
    async set(key, value, ttlSeconds) {
      try {
        await redisClient!.set(key, value, 'EX', ttlSeconds);
      } catch {
        // caché best-effort
      }
    },
  };
}

export async function closeCache(): Promise<void> {
  if (redisClient) {
    const client = redisClient;
    redisClient = null;
    await client.quit().catch(() => client.disconnect());
  }
}

export async function aggregatesVersion(db: FastifyInstance['db']): Promise<string> {
  const result = await sql<{ version: Date | string | null }>`
    select max(refreshed_at) as version from price_aggregate
  `.execute(db);
  const v = result.rows[0]?.version;
  return v ? new Date(v).toISOString() : '1970-01-01T00:00:00.000Z';
}

export async function cachedJson<T>(
  app: FastifyInstance,
  request: FastifyRequest,
  scope: string,
  ttlSeconds: number,
  producer: () => Promise<T>,
): Promise<T> {
  const version = await aggregatesVersion(app.db);
  const key = `v1:${scope}:${version}:${request.url}`;
  const hit = await app.cache.get(key);
  if (hit !== null) {
    return JSON.parse(hit) as T;
  }
  const fresh = await producer();
  await app.cache.set(key, JSON.stringify(fresh), ttlSeconds);
  return fresh;
}

export function registerCache(app: FastifyInstance, redisUrl?: string): void {
  app.decorate('cache', createCacheStore(redisUrl));
  app.addHook('onClose', async () => {
    await closeCache();
  });
}
