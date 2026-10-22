export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code?: string, details?: unknown) =>
  new HttpError(400, msg, code, details);
export const unauthorized = (msg = 'Please sign in') => new HttpError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'You do not have access to this') =>
  new HttpError(403, msg, 'FORBIDDEN');
export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`, 'NOT_FOUND');
export const conflict = (msg: string, code = 'CONFLICT', details?: unknown) =>
  new HttpError(409, msg, code, details);

/** Postgres unique-violation check (code 23505), optionally for a specific constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint_name?: string; cause?: unknown };
  if (e?.code === '23505') return !constraint || e.constraint_name === constraint;
  if (e?.cause) return isUniqueViolation(e.cause, constraint);
  return false;
}
