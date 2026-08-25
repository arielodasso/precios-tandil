import { sql } from 'kysely';

export const FRESH_WINDOW_DAYS = 7;

export const freshWindowInterval = sql.raw(`interval '${FRESH_WINDOW_DAYS} days'`);
