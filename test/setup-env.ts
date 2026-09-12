/**
 * Integration tests run against an in-memory SQLite database with Redis
 * disabled, so they need no external services. Every value can be overridden
 * from the environment - for example
 *
 *   REDIS_URL=redis://localhost:6379 npm run test:e2e
 *
 * to exercise the Redis cache and lock path against a real Redis.
 */
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_TYPE: 'better-sqlite3',
  DB_DATABASE: ':memory:',
  DB_SYNCHRONIZE: 'true',
  DB_LOGGING: 'false',
  REDIS_URL: '',
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
