import { QueryFailedError } from 'typeorm';

const DUPLICATE_KEY_CODES = new Set([
  'ER_DUP_ENTRY', // MySQL / MariaDB
  'SQLITE_CONSTRAINT_UNIQUE',
  'SQLITE_CONSTRAINT_PRIMARYKEY',
]);

const UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  'ER_ACCESS_DENIED_ERROR',
  'POOL_CLOSED',
  'SQLITE_CANTOPEN',
]);

const UNAVAILABLE_ERROR_NAMES = new Set([
  'ConnectionError',
  'ConnectionNotFoundError',
  'ConnectionIsNotSetError',
  'CannotConnectAlreadyConnectedError',
  'PoolNotFoundError',
]);

interface DriverError {
  code?: string;
  errno?: number;
}

function getDriverError(error: unknown): DriverError | undefined {
  if (error instanceof QueryFailedError) {
    return (error as QueryFailedError & { driverError?: DriverError })
      .driverError;
  }
  return undefined;
}

/**
 * True when a query failed because a unique constraint was violated, i.e. a
 * concurrent request inserted the same id1/id2 pair first.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }
  const driverError = getDriverError(error);
  if (driverError?.code && DUPLICATE_KEY_CODES.has(driverError.code)) {
    return true;
  }
  if (driverError?.errno === 1062) {
    return true;
  }
  return /duplicate entry|unique constraint/i.test(error.message);
}

/**
 * True when the failure is a connectivity problem rather than a bug: those are
 * reported as 503 so clients know the request can be retried.
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  const driverError = getDriverError(error);
  if (driverError?.code && UNAVAILABLE_CODES.has(driverError.code)) {
    return true;
  }
  if (error instanceof Error) {
    const code = (error as Error & { code?: string }).code;
    if (code && UNAVAILABLE_CODES.has(code)) {
      return true;
    }
    return UNAVAILABLE_ERROR_NAMES.has(error.name);
  }
  return false;
}
