export type ErrorCode =
  | 'invalid_query'
  | 'unauthorized'
  | 'not_found'
  | 'run_in_progress'
  | 'rate_limited'
  | 'internal_error'
  | 'circuit_open'
  | 'adapter_missing';

const HTTP_STATUS: Record<ErrorCode, number> = {
  invalid_query: 400,
  unauthorized: 401,
  not_found: 404,
  run_in_progress: 409,
  rate_limited: 429,
  internal_error: 500,
  circuit_open: 503,
  adapter_missing: 500,
};

export class AppError extends Error {
  readonly details?: unknown;

  constructor(
    readonly code: ErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    this.details = details;
  }

  get httpStatus(): number {
    return HTTP_STATUS[this.code];
  }
}
