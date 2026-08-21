import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  base: { service: 'worker' },
});

export function withRunId(runId: string, storeSlug: string): pino.Logger {
  return logger.child({ runId, storeSlug });
}
