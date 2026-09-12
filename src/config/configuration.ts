import { registerAs } from '@nestjs/config';

export type DatabaseType = 'mysql' | 'better-sqlite3';

export interface AppConfig {
  env: string;
  port: number;
  globalPrefix: string;
}

export interface DatabaseConfig {
  type: DatabaseType;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
  poolSize: number;
}

export interface RedisConfig {
  enabled: boolean;
  url: string;
  keyPrefix: string;
  cacheTtlSeconds: number;
  lockTtlMs: number;
}

/**
 * Environment variables are validated and coerced by the Joi schema, but the
 * helpers below keep these factories correct even when a value is a raw string.
 */
function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return ['true', '1', 'yes'].includes(value.trim().toLowerCase());
  }
  return fallback;
}

function toTrimmedString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : fallback;
}

export const appConfig = registerAs('app', (): AppConfig => ({
  env: toTrimmedString(process.env.NODE_ENV, 'development'),
  port: toNumber(process.env.PORT, 3000),
  globalPrefix: toTrimmedString(process.env.API_GLOBAL_PREFIX, 'api'),
}));

export const databaseConfig = registerAs('database', (): DatabaseConfig => ({
  type: (process.env.DB_TYPE ?? 'mysql') as DatabaseType,
  host: toTrimmedString(process.env.DB_HOST, 'localhost'),
  port: toNumber(process.env.DB_PORT, 3306),
  username: process.env.DB_USERNAME ?? '',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? '',
  synchronize: toBoolean(process.env.DB_SYNCHRONIZE, false),
  logging: toBoolean(process.env.DB_LOGGING, false),
  poolSize: toNumber(process.env.DB_POOL_SIZE, 10),
}));

export const redisConfig = registerAs('redis', (): RedisConfig => {
  const url = (process.env.REDIS_URL ?? '').trim();
  return {
    // An empty REDIS_URL turns Redis off. The application stays fully functional:
    // MySQL remains the single source of truth and the unique index still
    // guarantees that an id1/id2 pair maps to exactly one userID.
    enabled: url.length > 0,
    url,
    keyPrefix: toTrimmedString(process.env.REDIS_KEY_PREFIX, 'user-mapping:'),
    cacheTtlSeconds: toNumber(process.env.REDIS_CACHE_TTL_SECONDS, 900),
    lockTtlMs: toNumber(process.env.REDIS_LOCK_TTL_MS, 5000),
  };
});

export const configuration = [appConfig, databaseConfig, redisConfig];
