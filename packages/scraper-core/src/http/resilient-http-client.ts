import { Agent, ProxyAgent, request, type Dispatcher } from 'undici';
import type { Logger } from 'pino';
import { AppError } from '@precios/shared';

export interface ResilientHttpOptions {
  userAgents: string[];
  proxies?: string[];
  maxConcurrent?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  maxAttempts?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  timeoutMs?: number;
  logger?: Logger;
}

export interface FetchOptions {
  method?: 'GET' | 'POST';
  json?: unknown;
  headers?: Record<string, string>;
}

interface BreakerState {
  failures: number;
  state: 'closed' | 'open' | 'half-open';
  openedAt: number;
}

function jitter(min: number, max: number): number {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ResilientHttpClient {
  private readonly userAgents: string[];
  private readonly dispatchers: Dispatcher[];
  private readonly maxConcurrent: number;
  private readonly minDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly maxAttempts: number;
  private readonly breakerThreshold: number;
  private readonly breakerCooldownMs: number;
  private readonly timeoutMs: number;
  private readonly logger?: Logger;

  private inFlight = 0;
  private waiters: Array<() => void> = [];
  private breakers = new Map<string, BreakerState>();
  private dispatcherIdx = 0;
  private lastRequestAt = 0;

  constructor(opts: ResilientHttpOptions) {
    if (opts.userAgents.length === 0) throw new Error('userAgents no puede estar vacío');
    this.userAgents = opts.userAgents;
    const agent = new Agent({ connections: 8 });
    this.dispatchers = [agent, ...(opts.proxies ?? []).map((p) => new ProxyAgent(p))];
    this.maxConcurrent = opts.maxConcurrent ?? 2;
    this.minDelayMs = opts.minDelayMs ?? 800;
    this.maxDelayMs = opts.maxDelayMs ?? 2000;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.breakerThreshold = opts.breakerThreshold ?? 3;
    this.breakerCooldownMs = opts.breakerCooldownMs ?? 15 * 60_000;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.logger = opts.logger;
  }

  async fetchText(url: string, signal?: AbortSignal, opts: FetchOptions = {}): Promise<string> {
    await this.acquire();
    try {
      await this.pace();
      return await this.fetchWithRetries(url, signal, opts);
    } finally {
      this.release();
    }
  }

  async fetchJson<T>(url: string, signal?: AbortSignal, opts: FetchOptions = {}): Promise<T> {
    const text = await this.fetchText(url, signal, opts);
    return JSON.parse(text) as T;
  }

  private async pace(): Promise<void> {
    const now = Date.now();
    const wait = this.lastRequestAt + jitter(this.minDelayMs, this.maxDelayMs) - now;
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private acquire(): Promise<void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight++;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.waiters.push(() => {
        this.inFlight++;
        resolve();
      });
    });
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.inFlight--;
  }

  private breakerFor(origin: string): BreakerState {
    let b = this.breakers.get(origin);
    if (!b) {
      b = { failures: 0, state: 'closed', openedAt: 0 };
      this.breakers.set(origin, b);
    }
    return b;
  }

  private checkBreaker(origin: string): void {
    const b = this.breakerFor(origin);
    if (b.state === 'open') {
      if (Date.now() - b.openedAt >= this.breakerCooldownMs) {
        b.state = 'half-open';
        this.logger?.info({ origin }, 'circuit half-open');
      } else {
        throw new AppError('circuit_open', `Circuit abierto para ${origin}`);
      }
    }
  }

  private recordSuccess(origin: string): void {
    const b = this.breakerFor(origin);
    if (b.state !== 'closed') this.logger?.info({ origin }, 'circuit closed');
    b.failures = 0;
    b.state = 'closed';
  }

  private recordFailure(origin: string): void {
    const b = this.breakerFor(origin);
    b.failures++;
    if (
      (b.state === 'half-open' || b.failures >= this.breakerThreshold) &&
      b.failures >= this.breakerThreshold
    ) {
      b.state = 'open';
      b.openedAt = Date.now();
      this.logger?.warn({ origin, failures: b.failures }, 'circuit open');
    }
  }

  private pickDispatcher(): { dispatcher: Dispatcher; idx: number } {
    const idx = this.dispatcherIdx % this.dispatchers.length;
    this.dispatcherIdx++;
    return { dispatcher: this.dispatchers[idx]!, idx };
  }

  private async fetchWithRetries(
    url: string,
    externalSignal?: AbortSignal,
    opts: FetchOptions = {},
  ): Promise<string> {
    const origin = new URL(url).origin;
    this.checkBreaker(origin);
    let lastErr: unknown;

    const method = opts.method ?? 'GET';
    const body = opts.json !== undefined ? JSON.stringify(opts.json) : undefined;

    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      if (externalSignal?.aborted) throw new Error('abortado por señal externa');
      const ua = this.userAgents[Math.floor(Math.random() * this.userAgents.length)]!;
      const { dispatcher } = this.pickDispatcher();
      try {
        const res = await request(url, {
          dispatcher,
          method,
          ...(body !== undefined ? { body } : {}),
          headersTimeout: this.timeoutMs,
          bodyTimeout: this.timeoutMs,
          headers: {
            'user-agent': ua,
            accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'es-AR,es;q=0.9',
            ...(body !== undefined ? { 'content-type': 'application/json;charset=UTF-8' } : {}),
            ...(opts.headers ?? {}),
          },
          signal: externalSignal,
        });

        if (res.statusCode >= 200 && res.statusCode < 300) {
          const body = await res.body.text();
          this.recordSuccess(origin);
          return body;
        }
        await res.body.dump().catch(() => undefined);

        const retryable = res.statusCode >= 500 || res.statusCode === 429 || res.statusCode === 403;
        lastErr = new Error(`HTTP ${res.statusCode} en ${url}`);
        if (!retryable) break;
      } catch (err) {
        lastErr = err;
        if (externalSignal?.aborted) throw err;
      }

      if (attempt < this.maxAttempts - 1) {
        const backoff = 500 * 2 ** attempt + jitter(0, 250);
        await sleep(backoff);
      }
    }

    this.recordFailure(origin);
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}
